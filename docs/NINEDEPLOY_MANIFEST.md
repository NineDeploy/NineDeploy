# .ninedeploy Manifest

`.ninedeploy` is a project-side YAML file that declaratively describes how NineDeploy should build, run, route, alert, back up, and attach a service. The file is committed to the repo alongside the application source so that build, runtime, and routing behavior are reproducible from git alone — no click-through configuration in the panel, no per-developer setup drift.

Manifests are applied in two passes:

1. **Build time** — the docker builder reads the manifest, generates a Nixpacks-compatible `nixpacks.toml`, and pins the runtime, install/build/start commands, and Nix package set.
2. **Deploy time** — the deploy pipeline reads the manifest again and upserts the operational sections (routes → domains, alerts → alert rules, `database.ref` → managed DB attach).

The web panel, the CLI, and the `ninedeploy manifest {init,validate,show,apply}` subcommands all read and validate the same file.

---

## 🗂️ 1. Filenames & Precedence

The loader accepts any of the following names in the repository root, in this priority order:

| Priority | Filename |
| :--- | :--- |
| 1 | `.ninedeploy` |
| 2 | `.ninedeploy.yml` |
| 3 | `.ninedeploy.yaml` |
| 4 | `ninedeploy.yml` |
| 5 | `ninedeploy.yaml` |

The first file found is used. The dotfile `.ninedeploy` (no extension) is the canonical form and is what `ninedeploy manifest init` writes by default. Files larger than **16 KiB** are refused at load time.

---

## 🔒 2. Never Put Secrets in the Manifest

The manifest is committed to the repo, so it must **never** contain credentials, tokens, or connection strings. The loader runs a regex scan against every byte of the file before validation; any hit fails the load with a `ManifestSecretError` that names the offending pattern (the value itself is redacted).

The scanner matches the following patterns:

| ID | Detects |
| :--- | :--- |
| `aws-access-key` | AWS access key id (`AKIA…`) |
| `github-pat-classic` | GitHub personal access token (`ghp_…`) |
| `github-pat-fine-grained` | GitHub fine-grained PAT (`github_pat_…`) |
| `gitlab-pat` | GitLab personal access token (`glpat-…`) |
| `slack-token` | Slack token (`xox[baprs]-…`) |
| `stripe-live-secret` | Stripe live secret key (`sk_live_…`) |
| `stripe-live-restricted` | Stripe live restricted key (`rk_live_…`) |
| `openai-secret` | OpenAI API key (`sk-…`) |
| `anthropic-key` | Anthropic API key (`sk-ant-…`) |
| `discord-webhook` | Discord webhook URL |
| `database-url-credentials` | DB URL with embedded `user:pass@` |
| `private-key` | PEM private key block |
| `jwt-bearer` | Literal `Bearer eyJ…` value |

Values that need to remain secret go into the **panel env vault**; the manifest only references them by name via `env.required`.

---

## ⚖️ 3. Merge Precedence

When a service is built, every field is resolved through a three-tier merge. Higher tiers win:

```
panel/DB  >  manifest  >  auto-detect
```

- A value explicitly set in the panel or stored in the database always wins.
- If the panel is silent, the manifest fills the gap.
- If the manifest is silent too, NineDeploy's own auto-detection (file markers, Nixpacks heuristics) is used.

This makes the manifest a *project default*, not a hard override. The same project can be deployed with a different runtime from the panel for one-off experiments without editing the file.

---

## 📐 4. Schema Reference

The manifest is a single YAML document with a fixed top-level `version: "1"`. Every section is optional; omit any section you don't need. The schema is strict — unknown keys are rejected.

```yaml
version: "1"
```

### 4.1 `runtime` — Language & Version

Pins the language runtime Nixpacks should install. `version` is `<major>` or `<major>.<minor>` or `<major>.<minor>.<patch>`.

```yaml
runtime:
  type: node          # auto | node | python | go | ruby | php | java | rust | static
  version: "20"       # optional; 20 / 20.18 / 3.12 are all valid
```

When `type` is `static`, use the `static` section instead of `build`/`run` — see §4.4.

### 4.2 `build` — Install / Build / Start

Override the Nixpacks phases. Each field maps to a phase cmd; only the fields you set are overridden, the rest stay auto-detected.

```yaml
build:
  install: "npm ci"                 # [phases.install].cmds
  build: "npm run build"            # [phases.build].cmds
  start: "npm start"                # [phases.start].cmd
  baseDir: "apps/web"               # run build from a monorepo sub-path
  dockerfile: "Dockerfile.alpine"   # explicit Dockerfile path
```

`baseDir` is useful for monorepos where the service lives in a sub-folder. `dockerfile` short-circuits the auto-detect → Nixpacks path entirely.

### 4.3 `run` — Port, Healthcheck, Restart Policy

```yaml
run:
  port: 3000                        # container port; 1–65535
  healthcheck: "/healthz"           # GET path polled before traffic flip
  restart: unless-stopped           # no | always | unless-stopped | on-failure | on-failure:N
```

`on-failure:N` accepts a retry count (1–999, no leading zero). The healthcheck path is probed on the loopback address inside the container; it must return 2xx for the blue-green release to flip traffic.

### 4.4 `static` — Pre-Built SPA

For services that build into a `dist/` directory and need no Node process. Nixpacks installs nothing; NineDeploy serves the directory with a built-in static handler.

```yaml
static:
  spa: true                         # serve /index.html for unmatched routes
  root: "dist"                      # relative path inside the container
```

`root` must be a relative path with no `.` or `..` segments.

### 4.5 `env` — Required Vars & Aliases

Declare the env var names a service expects, and (optionally) rename the env keys NineDeploy injects from managed databases.

```yaml
env:
  required:                          # names the panel env vault must provide
    - DATABASE_URL
    - STRIPE_SECRET_KEY
  aliases:                           # rename attached-DB env vars
    POSTGRES_URL: DATABASE_URL       # source → dest (NineDeploy injects POSTGRES_URL
                                     #   from the attached DB; this rewrites it
                                     #   to DATABASE_URL at runtime)
```

The values themselves live in the panel env vault, never in the manifest.

### 4.6 `phases` — Nixpacks Phase Overrides (Advanced)

For fine-grained control over what Nixpacks installs and runs. Use `build` (§4.2) first; reach for `phases` when you need to install system packages.

```yaml
phases:
  setup:
    pkgs:                            # nixPackages entries (additive)
      - imagemagick
      - libpq
  build:
    cmds:                            # additional commands run in [phases.build]
      - "prisma generate"
```

### 4.7 `resources` — CPU & Memory Limits

```yaml
resources:
  cpuShares: 1024                    # 0–262144 (Docker --cpu-shares)
  memMb: 512                         # 0–1048576 (MB; Docker -m)
```

When omitted, the container inherits the host's defaults.

### 4.8 `hooks` — Lifecycle Hooks

Shell commands run at three points in the container lifecycle. Each is a single command line (max 500 chars).

```yaml
hooks:
  preBuild: "echo 'about to npm ci'"   # runs in build env, before install
  postBuild: "echo build done"         # runs in build env, after build
  preStop: "drain-connections"         # runs in container, before SIGTERM
```

### 4.9 `watch` — Monorepo Watch Paths

Glob patterns that decide whether a push triggers a deploy. Useful when many packages share a repo and only some should rebuild.

```yaml
watch:
  paths:
    - "apps/web/**"
    - "packages/ui/**"
    - "!**/*.test.ts"
```

When `watch.paths` is set, a push whose diff does not touch any matching file is skipped (webhook fires, deploy is a no-op).

### 4.10 `routes` — Public Hostnames

List of hostnames the service should respond on. Upserted into the domains table on every deploy.

```yaml
routes:
  - host: app.example.com
    path: /                            # optional; defaults to "/"
    ssl: true                          # issue & auto-renew Let's Encrypt cert
    redirectWww: true                  # 301 www → apex
    headers:                           # response headers added by Traefik
      X-Frame-Options: DENY
      Strict-Transport-Security: "max-age=31536000; includeSubDomains"
    ipAllowlist:                       # CIDR allowlist (deny by default when set)
      - 1.2.3.4/32
      - 10.0.0.0/8
    rateLimit:                         # requests per second
      average: 50
      burst: 100
```

### 4.11 `previews` — Ephemeral PR Environments

```yaml
previews:
  enabled: true
  pattern: "pr-{n}.previews.example.com"   # {n} is the PR number
  maxActive: 5                              # 1–50
  autoDestroyOnClose: true                  # teardown on PR close
```

`pattern` must contain `{n}` when `enabled: true`. The web panel still owns the per-PR environment lifecycle (create, list, destroy); the manifest only declares the routing pattern and retention policy.

### 4.12 `volume` — Persistent Mount

```yaml
volume:
  mount: "/var/lib/app/data"          # absolute path inside the container
  backups:
    schedule: "0 3 * * *"             # cron expression
    retention: 14                     # 1–365 days
```

The mount path must be absolute and must not contain `..` segments. The backup schedule is a standard 5-field cron expression; snapshots are written to the workspace's configured S3-compatible destination.

### 4.13 `database` — Managed-DB Attach Hint

```yaml
database:
  ref: primary-postgres               # slug of an existing managed DB
  env: DATABASE_URL                   # env var name to inject the URL into
```

The DB itself is provisioned in the panel (or via the MCP/CLI). At deploy time the pipeline looks up the DB by `ref`, generates a connection URL, and writes it into the service's runtime env under the `env` key. If the DB does not exist, a warning is emitted and the deploy continues without the injection.

### 4.14 `network` — Publish & Aliases

```yaml
network:
  publishPort: 8080                   # host port to map (rarely needed)
  aliases:                            # additional Docker network aliases
    - api.internal
```

`aliases` are useful for service-to-service discovery when multiple services share a network.

### 4.15 `notifications` — Channel References

The manifest references notification channels **by name**; the channels themselves (Slack, Discord, email, etc.) are configured in the panel.

```yaml
notifications:
  onDeploy: ["deploys"]               # notify when a deploy succeeds
  onFailure: ["deploys", "oncall"]     # notify on failure
  onAlert:   ["oncall"]                # notify when an alert fires
```

The resolver looks up each name in the workspace's channel list; an unknown name is logged as a warning and skipped.

### 4.16 `alerts` — Monitoring Rules

```yaml
alerts:
  - when: highMemory
    channel: oncall
    thresholdPct: 85                  # required for highMemory / highCpu
  - when: highCpu
    channel: oncall
    thresholdPct: 90
  - when: deployFailed
    channel: deploys
  - when: restartLoop
    channel: oncall
  - when: certExpiry
    channel: oncall
```

`thresholdPct` (1–100) is required for `highMemory` and `highCpu`; the other `when` values do not accept a threshold. Each rule fires into exactly one named channel.

---

## 🛠️ 5. CLI Usage

The `@ninedeploy/cli` package ships four subcommands under `ninedeploy manifest`:

```bash
ninedeploy manifest init       # detect project kind, write a starter .ninedeploy
ninedeploy manifest validate   # parse + schema check the file in cwd
ninedeploy manifest show       # human-readable summary of the parsed manifest
ninedeploy manifest apply      # push the operational sections to the panel
```

- `init` auto-detects the project kind (Node/pnpm, Node/npm, Python, Go, Vite, Unknown) from the files in `cwd` and writes a starter. The kind can be overridden interactively.
- `validate` exits non-zero on schema or YAML errors. Add it to CI before pushing.
- `show` prints a key/value summary; useful for debugging what the pipeline will read.
- `apply` is wired but pending a server-side endpoint. It currently prints a "not in this release yet" message and points the operator at this document. **Until the endpoint ships, manifests are applied automatically on each deploy** by the build pipeline (§6).

---

## 🖥️ 6. How the Pipeline Applies the Manifest

### 6.1 Build Stage (Nixpacks)

`apps/server/src/lib/ninedeployToNixpacks.ts` translates the manifest into a `nixpacks.toml` that is written next to the checked-out source. The mapping is:

| Manifest field | nixpacks.toml key |
| :--- | :--- |
| `runtime.type` + `version` | `nixPkgs = ["nodejs_20"]` and `NIXPACKS_NODE_VERSION="20"` (analogous for other runtimes) |
| `phases.setup.pkgs` | `nixPkgs += […]` (additive) |
| `phases.build.cmds` | `[phases.build].cmds += […]` |
| `build.install` | `[phases.install].cmds = ["npm ci"]` |
| `build.build` | `[phases.build].cmds` (prepended) |
| `build.start` | `[phases.start].cmd = "npm start"` |

`build.dockerfile` short-circuits the Nixpacks path entirely — the manifest still applies, but only the `run`, `env`, `routes`, `alerts`, and `database` sections take effect (the image is built from your Dockerfile).

### 6.2 Deploy Stage (Pipeline)

`apps/server/src/lib/applyManifestToService.ts` runs in the `PREPARE` stage of every deploy. The wired sections are:

| Manifest field | Pipeline action |
| :--- | :--- |
| `routes[]` | upsert into `domains` (one row per host, with path/SSL/headers/CIDR/rate-limit) |
| `alerts[]` | upsert into `alert_rules` (one row per alert, with `when` and `channel`) |
| `database` | lookup the DB by `ref` and inject the connection URL into the service's env under `env` |

The stubbed sections (emitted as deploy warnings, not yet applied) are:

- `volume.backups` — schedule + retention persistence
- `notifications.*` — channel-name resolution into the notification router
- `previews.*` — pattern registration with the preview controller

These will be wired in the next minor release; until then, configure them through the panel.

---

## 🧑‍🎨 7. Manifest Creator (Web UI)

The **Deploy → Manifest Creator** page in the web panel is a guided form for editing a manifest without writing YAML by hand. It is divided into two columns: a left-side outline of the 16 sections (with a filled/dot indicator per section) and a right-side editor with the active section's controls.

Capabilities:

- **Starter presets** (Blank, Node 20 npm, Node 20 pnpm, Python 3.12, Go 1.22, Static SPA) replace the form state wholesale.
- **Drafts autosave** to `localStorage` under `ninedeploy.manifest.draft`; the form rehydrates on reload.
- **Live YAML preview** in a modal with a client-side secret scan (3 patterns: AWS, GitHub PAT, DB creds) — banners the operator early, before the server-side scan refuses at deploy time.
- **Copy / Download / Reset** actions on the preview.
- **Service prefill**: opening the creator from a service detail page (via the "Open in Creator" button on the **Manifest** tab) pre-seeds `run.port` and `run.healthcheck` from the service's panel config, but only when the form is still the empty starter — manual edits are not clobbered.

The creator is purely client-side: nothing it produces is sent to the server. The operator copies the YAML into `.ninedeploy` at the repo root and commits it.

---

## 🩺 8. Validation

### 8.1 Schema

Every field is validated against the Zod schema in `@ninedeploy/schemas`. Unknown keys fail with `path: "<section>"` and a message naming the unexpected key. Numeric ranges (ports, CPU shares, retention days, etc.) are bounded; out-of-range values fail with the constraint in the message.

### 8.2 Secret Scan

The server-side scanner runs on the raw file before validation; the client-side scanner (Manifest Creator preview) runs on the formatted YAML. Both redact matched values in the error output (first 4 + last 2 chars, with full length).

### 8.3 Size Limit

Files larger than 16 KiB are refused with `ManifestTooLargeError`. The manifest is meant to be a thin pointer to behavior, not a dump of config — if you need that, split it into multiple files and use the panel for the rest.

---

## 🧪 9. End-to-End Example

A minimal Node + Postgres service:

```yaml
version: "1"

runtime:
  type: node
  version: "20"

build:
  install: "npm ci"
  build: "npm run build"
  start: "npm start"

run:
  port: 3000
  healthcheck: "/healthz"
  restart: unless-stopped

env:
  required:
    - DATABASE_URL
    - STRIPE_SECRET_KEY
  aliases:
    POSTGRES_URL: DATABASE_URL

watch:
  paths:
    - "apps/api/**"
    - "packages/shared/**"

routes:
  - host: api.example.com
    path: /
    ssl: true
    headers:
      X-Frame-Options: DENY
    ipAllowlist:
      - 10.0.0.0/8

previews:
  enabled: true
  pattern: "pr-{n}.previews.example.com"
  maxActive: 3
  autoDestroyOnClose: true

volume:
  mount: "/var/lib/api/uploads"
  backups:
    schedule: "0 3 * * *"
    retention: 14

database:
  ref: primary-postgres
  env: DATABASE_URL

notifications:
  onDeploy: ["deploys"]
  onFailure: ["deploys", "oncall"]

alerts:
  - when: highMemory
    channel: oncall
    thresholdPct: 85
  - when: deployFailed
    channel: deploys
```

What happens on push:

1. Webhook fires; the `watch.paths` glob matches the diff → deploy starts.
2. The docker builder generates `nixpacks.toml` with `nodejs_20`, the install/build/start cmds, and the `prisma generate` hook from `phases.build.cmds` (if you had one).
3. The container boots on port 3000; `/healthz` is probed; Traefik routes `api.example.com` to it.
4. The `primary-postgres` DB is looked up; its connection URL is injected as `DATABASE_URL` (rewritten from the DB's default `POSTGRES_URL`).
5. The two alert rules are upserted in `alert_rules`.
6. The `oncall` channel receives a message only if memory crosses 85% or a deploy fails.

---

## 🛟 10. Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Build picks the wrong Node version | `runtime.version` not set and Nixpacks auto-detected a different version | Add `runtime: { type: node, version: "20" }` |
| `npm ci` fails with `package-lock.json not found` | Lock file not committed | Run `npm install` locally and commit the lock file |
| Route 404s after deploy | `routes` not declared and panel is empty for that service | Add a `routes[]` entry, or set the domain in the panel |
| `ManifestSecretError` on a deploy | Manifest contains a literal token | Move the value to the panel env vault; reference by name in `env.required` |
| DB not attached after deploy | `database.ref` does not match any managed DB slug | Verify the slug in the panel Databases tab; the pipeline logs the missing slug as a warning |
| Preview URL is `<service>.com` instead of `pr-N.<host>` | `previews.pattern` doesn't contain `{n}` | Pattern must include the literal token `{n}` |
| Volume backups never run | `volume.backups.schedule` is not a valid cron | Standard 5-field cron only; the panel validates the same string |
| Modal closes on first Tab press | Focus trap fires on `initialFocusRef` with disabled children | Ensure the ref'd element is enabled; the trap falls back to the first focusable in the panel |

For deploy-time issues that aren't in this list, see [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## 📚 11. Related Documents

- [docs/DEPLOYMENTS.md](./DEPLOYMENTS.md) — Blue-green releases, rollbacks, previews
- [docs/DATABASES_BACKUPS.md](./DATABASES_BACKUPS.md) — Managed DBs + backup destinations
- [docs/TRAEFIK_INGRESS.md](./TRAEFIK_INGRESS.md) — Routing layer
- [docs/QUICKSTART.md](./QUICKSTART.md) — First-deploy walkthrough
- [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Common failure modes
