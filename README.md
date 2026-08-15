# NineDeploy

Self-hosted deployment platform. Deploy apps from Git or a container registry in one click — with zero-downtime releases, automatic rollback, managed databases, HTTPS routing, and a full security model.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue.svg)](https://docker.com)
[![CI](https://github.com/NineDeploy/NineDeploy/actions/workflows/ci.yml/badge.svg)](https://github.com/NineDeploy/NineDeploy/actions/workflows/ci.yml)

## What is NineDeploy?

NineDeploy is a self-hosted PaaS that runs on your own server. It wraps PM2 and Docker behind a web dashboard and CLI, gives you Traefik for HTTPS routing, and handles webhooks, managed databases, monitoring, notifications, and Cloudflare Tunnels.

Deploy from a Git repository, a container image, or the built-in template hub with 48 one-click apps. All state stays on your server in a single SQLite database — no external dependencies. Every source file across the monorepo is held at **100% test coverage**, enforced in CI.

## Quick start

### Option A: One-click install (Linux, bare-metal — recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/NineDeploy/NineDeploy/main/install.sh | bash
```

Bare-metal is the recommended production mode: the core runs under systemd with direct Docker daemon + PM2 access. The installer renders a **hardened `ninedeploy.service` unit** (paths and the run user templated per install): `Requires=docker.service`, `Type=notify` + `WatchdogSec=90` with dependency-free sd_notify pings (a hung process restarts automatically), `NoNewPrivileges`, `ProtectSystem=strict` with `ReadWritePaths` limited to the data directory, `PrivateTmp`, and `Restart=always` (5 s backoff).

### Upgrading

Re-running the installer on an existing install performs an **in-place upgrade**: it stops the service, snapshots the DB + master key to `.data/upgrade-backups/`, checks out the resolved version, rebuilds, runs migrations, restarts, and waits up to 60 s for `/health` before declaring success.

```bash
curl -fsSL https://raw.githubusercontent.com/ninedeploy/ninedeploy/main/install.sh | bash   # latest release tag (default)
bash install.sh --version v0.1.0   # pin an exact release
bash install.sh --channel main     # edge: track the main branch
```

Docker installs upgrade with `docker pull` + container recreate — pending migrations apply automatically on startup. The About page and `ninedeploy system update-check` compare the running version against the latest GitHub release (`NINEDEPLOY_UPDATE_CHECK_URL` overrides the feed; set it to `disabled` for air-gapped hosts).

### Password recovery

- **Forgot password** — the login page links to `/forgot-password`; if an email (SMTP) notification channel is configured, a single-use 30-minute reset link is emailed to the user
- **No SMTP?** An admin generates a one-time reset link from the Users page (link icon) or the CLI (`ninedeploy reset-link <idOrEmail>`) and hands it to the user — the raw token is shown exactly once
- Completing a reset revokes all of the user's outstanding sessions; tokens are stored sha256-hashed and swept by housekeeping after 24 h
- **Brute-force protection** — 5 failed logins lock an account for 15 minutes (on top of the per-IP rate limit)
- **Two-factor authentication** — TOTP (RFC 6238) with a two-step login; disable requires password + code and revokes every session
- **Scheduled jobs** — cron-scheduled redeploys and container commands per service (5-field expressions, run history with output)
- **Remote servers** — register hosts running the NineDeploy agent (`NINEDEPLOY_AGENT=1`); the agent exposes a fixed table of typed operations (docker pull/build/run, compose up/down, git clone/checkout, env-file write) — requests never carry a program name or raw argv, and every operand is regex-validated

### Option B: Docker (persistent data volume)

```bash
docker run -d --name ninedeploy \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ninedeploy-data:/data \
  -p 3000:3000 \
  -e NINEDEPLOY_JWT_SECRET=$(openssl rand -hex 32) \
  ghcr.io/ninedeploy/ninedeploy
```

All state (SQLite, repos, logs, backups, master key) lives in the `ninedeploy-data` volume; schema migrations apply automatically on startup. The host Docker socket lets the deploy engine manage your other containers. PM2-based services need the bare-metal install; Docker services and templates work in both modes.

### Option C: From source (development)

```bash
git clone https://github.com/NineDeploy/NineDeploy.git
cd ninedeploy
pnpm install
cp .env.example .env
pnpm build
pnpm dev
```

Open `http://localhost:5173` and create the first admin account. Requires Node ≥ 22.13, pnpm 11 (via corepack), and Docker. `docker compose up` also boots a full dev environment.

## Deploy pipeline

- **Deploy pipeline** — cancel in-flight deployments, watch-path webhooks (monorepo filters), Docker Compose services, private-registry credentials, cron-scheduled jobs (redeploys + container commands), agent-based remote servers (typed-operation protocol — remote hosts never execute raw commands)
- **Git repo** (public/private via PAT or SSH deploy key) or **container image** — build from source or run pre-built images
- **Zero-downtime releases (Docker)** — blue-green: the new container is healthchecked *before* the old one retires; on failure the previous version keeps serving (automatic rollback)
- **Health checks** — container liveness (`docker inspect`) + HTTP probe on the container's network IP with a sibling-container probe fallback (so deploys also work on Docker Desktop, where container IPs are unreachable from the host)
- **One-click rollback** — redeploys the exact commit, or the pinned **image digest** — never a moved `:latest` tag
- **Bounded subprocesses** — every build/clone has a timeout with tree-kill (SIGTERM → SIGKILL); a hung build can never block the deploy queue
- **Crash recovery** — deployments stranded mid-build by a restart are swept on boot; the worker claims deployments atomically
- **PM2 mode** — Node apps under the PM2 daemon with memory limits; brief-gap deploys with rollback (two versions can't share a port)
- **Auto-deploy** — GitHub/GitLab/Gitea webhooks with HMAC verification and replay dedup (a captured push can't flood the queue)
- **Live deploy logs** — real-time WebSocket streaming + container exec terminal (admin-only, audited)

## Security model

- **Auth** — JWT access (15 m) + refresh (7 d) tokens with silent browser refresh; opaque API tokens (sha256-hashed) for CI/CLI
- **Session revocation** — logout, role change, password change/reset all bump a per-user `tokenVersion`, killing every outstanding JWT statelessly (the refresh endpoint enforces it too)
- **Password lifecycle** — self-service change (Settings) and admin reset (Users), Argon2id at rest
- **RBAC** — admin-only for system-wide and destructive actions: exec shell, volumes, sources, tunnels, notifications, system export/import, service bundles, user management, instance settings; members manage services
- **Registration control** — open registration can be disabled by an admin (Settings → Security); first-run bootstrap always works
- **Rate limiting** — global IP ceiling + tight limits on auth/setup/webhook endpoints
- **Production guard** — the server refuses to boot in production with the insecure default JWT secret
- **Secrets at rest** — AES-256-GCM in versioned envelopes; the master key is **rotatable** (`NINEDEPLOY_MASTER_KEYS` key ring + re-encryption job) without invalidating existing secrets
- **Secrets in motion** — runtime secrets travel via temp `--env-file` (never `-e` argv / `ps`); build subprocesses inherit only a whitelisted environment (never the master key); DB backup/restore uses arg-array `docker exec` + `docker cp` (no host shell → no injection); git tokens are scrubbed from `.git/config` and SSH keys wiped after checkout
- **Networking** — app containers publish **no host ports at all**; Traefik is the only ingress, routing by container name over a shared Docker network; its dynamic config is written atomically with sanitized Host/Path operands
- **Hardened import/export** — tar members validated before extraction (tar-slip), rollback restores the original state if a system import fails midway
- **CORS allowlist** — public URL + dev origins + `NINEDEPLOY_CORS_ORIGINS`; request logs never contain query strings (WS tokens)

## Managed databases

- **PostgreSQL · MySQL · MariaDB · Redis · MongoDB** — one-click with persistent storage; idempotent start (no name conflicts)
- **Auto-generated credentials** — encrypted at rest; `DATABASE_URL`-style connection strings auto-injected into attached services
- **Backups** — `pg_dump`/`mysqldump`/`mariadb-dump`/`mongodump`/RDB snapshot + restore + download — **encrypted at rest** with the master key (legacy plaintext backups still restore); daily auto-backup keeps the last 7 **scheduled** backups and never touches manual ones
- **Off-site destinations** — any S3-compatible endpoint (MinIO, R2, B2, AWS) via a built-in SigV4 client with zero dependencies; the encrypted envelope is uploaded after every backup, and restore fetches the remote copy when the local file is gone
- **Bounded retention** — metrics (24 h), deploy logs (30 d), audit log (90 d), notification log (30 d), dangling Docker images — pruned automatically

## Management

- **Dashboard** — live health probes, stats grid, recent activity
- **Domain management** — routing map + SSL toggle; wildcard auto-assign (`{slug}.your-domain`); **certificate expiry badges** (warning under 14 days) from Traefik's ACME storage
- **Wildcard SSL (DNS-01)** — ACME DNS challenge via Cloudflare/DigitalOcean/Hetzner/Linode/Gandi/DuckDNS API tokens (encrypted at rest, delivered to Traefik via docker `--env-file`); one `*.your-domain` certificate issued up front and routed with `HostRegexp`
- **Monitoring** — live CPU/memory per container + host overview + **alert rules**
- **Alerting** — threshold rules on `cpu` (%), `memory` (MiB), and `cert-expiry` (days); sustained-breach duration windows (30 s samples), one-shot firing with cooldown, recovery notifications — delivered through the notification channels
- **Template Hub** — 48 one-click apps from a schema-validated JSON registry (swappable source with caching/fallback); secret env values are **auto-generated at deploy time** (registry defaults like `changeme` never ship), templates that need a database (Umami, WordPress, Ghost, BookStack, Strapi) get one **auto-provisioned and attached** (`DATABASE_URL` injected)
- **Topology** — interactive graph of services ↔ databases ↔ domains
- **Notifications** — Telegram / Discord / Slack / ntfy / email (SMTP, encrypted credentials) / generic webhooks, with event filters, timeouts, HTML-safe messages, and retry with exponential backoff (3 attempts)
- **Multi-user** — roles, audit log, activity feed, registration toggle, ACME email setting
- **Migration** — full system export/import (with rollback) and per-service bundles (admin-only; bundles contain plaintext secrets)
- **CLI** — `setup · login · logout · whoami · config · token · services · deploys (list/rollback/watch) · databases · templates · env · domains · volumes · backups · alerts · users · activity · system (info/dashboard/export/import)`
- **UX** — command palette (⌘K), dark/light + 6 accents, toasts

### CLI

The CLI stores its server URL + token in `~/.ninedeploy/config.json` (0600, created by `setup`/`login`; defaults to `http://localhost:3000`).

```bash
ninedeploy setup                                 # bootstrap first admin / configure
ninedeploy login                                 # authenticate (stores token)
ninedeploy config --server http://localhost:3000
ninedeploy services list
ninedeploy services deploy my-app                # queue a deploy
ninedeploy deploys list my-app
ninedeploy deploys watch my-app 7                # stream live build logs
ninedeploy deploys rollback my-app 7             # redeploy exact commit/digest
ninedeploy env set my-app API_KEY '…'            # secret by default (--public for plain)
ninedeploy domains add my-app app.example.com    # SSL on; --no-ssl for plain HTTP
ninedeploy backups list
ninedeploy backups create 3
ninedeploy alerts list                           # rule state (ok/breaching/firing)
ninedeploy system dashboard                      # aggregate health/stats
```


### Template verification (real deployments)

All templates are deployed and health-checked against a live Docker host before release.
Current status (macOS Docker Desktop, arm64):

| Status | Notes |
|---|---|
| ✅ 41 running out of the box | incl. n8n, Grafana, Jellyfin, Plex, Nextcloud, WordPress, Ghost, Umami, Gitea, Pi-hole, MinIO, code-server, Prometheus, Loki, Home Assistant |
| ⚠️ Documented requirements | LibreTranslate (model downloads, 4 GB+ RAM), Open WebUI (~4 GB image), Mattermost (no arm64 image), BookStack (may need DB_HOST-style env), Nginx Proxy Manager (redundant with built-in Traefik) |
| ❌ Removed | Strapi (no official image) |

Secrets (`GF_SECURITY_ADMIN_PASSWORD`, `MEILI_MASTER_KEY`, `MINIO_ROOT_PASSWORD`, code-server `PASSWORD`, Pi-hole `WEBPASSWORD`) are auto-generated per deploy.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NINEDEPLOY_HOST` | `0.0.0.0` | IP address to bind |
| `NINEDEPLOY_PORT` | `3000` | Port for the dashboard and API |
| `NINEDEPLOY_PUBLIC_URL` | `http://localhost:3000` | Public URL (webhooks, CORS) |
| `NINEDEPLOY_CORS_ORIGINS` | *(empty)* | Comma-separated extra origins allowed by CORS |
| `NINEDEPLOY_DATA_DIR` | `./.data` | SQLite, repos, logs, backups, Traefik config |
| `NINEDEPLOY_DB_PATH` | `./.data/ninedeploy.db` | SQLite database file (migrated automatically on startup) |
| `NINEDEPLOY_JWT_SECRET` | generated | **Must be custom in production** — the server refuses the insecure default |
| `NINEDEPLOY_MASTER_KEY` | generated | AES-256 key for encrypting secrets |
| `NINEDEPLOY_MASTER_KEYS` | *(empty)* | Key ring for rotation: `0:<old-hex>,1:<new-hex>` — highest version encrypts, lower versions keep old secrets readable |
| `NINEDEPLOY_MIGRATIONS_DIR` | auto | Override the SQL migrations folder (auto-resolved otherwise) |
| `NINEDEPLOY_WILDCARD_DOMAIN` | *(empty)* | Auto-assign `{slug}.domain` URLs |
| `NINEDEPLOY_ACME_EMAIL` | *(empty)* | Let's Encrypt registration email fallback — the Settings → Security ACME email overrides it; enables automatic HTTPS (the domain SSL toggle then issues real certificates via Traefik ACME) |
| `NINEDEPLOY_DEPLOY_CONCURRENCY` | `1` | Parallel deploy slots in the worker (1-8). The same service is never deployed concurrently — busy services' queued deploys wait |
| `NINEDEPLOY_ACME_CA_SERVER` | *(empty)* | ACME directory override — point at Let's Encrypt **staging** while testing wildcard/HTTPS setup to dodge production rate limits |
| `NINEDEPLOY_DNS_PROVIDER` | *(empty)* | DNS-01 challenge provider for wildcard certificates (cloudflare, digitalocean, hetzner, linode, gandi, duckdns) — the Settings → Security DNS config wins |
| `NINEDEPLOY_DNS_TOKEN` | *(empty)* | DNS provider API token (env fallback; stored encrypted when set via Settings) |
| `NINEDEPLOY_TEMPLATES_SOURCE` | *(empty)* | Template registry source override (https URL or absolute path to a JSON bundle) — the Settings → Hub setting wins; bundled `registry.json` is the fallback. Remote sources are cached (6 h TTL) with offline fallback |
| `NINEDEPLOY_UPDATE_CHECK_URL` | GitHub releases feed | Update-check feed (JSON with `tag_name`); set to `disabled` for air-gapped instances. Results are cached 6 h |

## API

All endpoints under `/v1` require `Authorization: Bearer <token>` (except auth/setup/hooks/events/status). `POST /v1/setup` only works while the instance has zero users (first-run bootstrap).

```bash
# Setup (first admin) / login / refresh / logout
curl -X POST http://localhost:3000/v1/setup -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret","name":"Admin"}'
curl -X POST http://localhost:3000/v1/auth/login   -d '{"email":"…","password":"…"}'
curl -X POST http://localhost:3000/v1/auth/logout  -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/v1/auth/password -H "Authorization: Bearer $TOKEN" \
  -d '{"currentPassword":"…","newPassword":"…"}'        # revokes other sessions

# Deploy / rollback / metrics
curl -X POST http://localhost:3000/v1/services/1/deploys -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/v1/services/1/deploys/7/rollback -H "Authorization: Bearer $TOKEN"
curl "http://localhost:3000/v1/services/1/metrics?kind=cpu&minutes=60" -H "Authorization: Bearer $TOKEN"

# Update a service (fields + build config)
curl -X PATCH http://localhost:3000/v1/services/1 -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"branch":"main","port":3001,"build":{"startCmd":"npm start"}}'

# Alerts: create + state
curl -X POST http://localhost:3000/v1/alerts -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"high-cpu","metric":"cpu","operator":">","threshold":90,"durationWindows":4}'
curl http://localhost:3000/v1/alerts -H "Authorization: Bearer $TOKEN"

# Notifications: channels + test + delivery log
curl -X POST http://localhost:3000/v1/notifications/channels -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ops-tg","type":"telegram","target":{"chatId":"…","botToken":"…"}}'
curl -X POST http://localhost:3000/v1/notifications/channels/1/test -H "Authorization: Bearer $ADMIN"
curl http://localhost:3000/v1/notifications/log -H "Authorization: Bearer $ADMIN"

# Settings: template registry source + DNS-01 (wildcard SSL) + ACME email
curl -X PUT http://localhost:3000/v1/settings/templates-source -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"source":"https://example.com/registry.json"}'
curl -X PUT http://localhost:3000/v1/settings/dns -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"provider":"cloudflare","token":"…"}'
curl -X PUT http://localhost:3000/v1/settings/acme-email -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"email":"admin@example.com"}'

# Topology / stats / activity / update check
curl http://localhost:3000/v1/topology -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/v1/stats -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/v1/activity -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/v1/system/update-check -H "Authorization: Bearer $ADMIN"

# Password reset: request a link (always 200) + complete it
curl -X POST http://localhost:3000/v1/auth/forgot-password -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com"}'
curl -X POST http://localhost:3000/v1/auth/reset-password -H 'Content-Type: application/json' \
  -d '{"token":"<one-time-token>","newPassword":"fresh-pass-123"}'
# Admin: mint a one-time reset link for user 2 (shown exactly once)
curl -X POST http://localhost:3000/v1/users/2/reset-link -H "Authorization: Bearer $ADMIN"

# Admin: registration toggle / password reset
curl http://localhost:3000/v1/settings -H "Authorization: Bearer $ADMIN"
curl -X PUT http://localhost:3000/v1/settings/allow-registration -H "Authorization: Bearer $ADMIN" \
  -d '{"enabled":false}'
curl -X PATCH http://localhost:3000/v1/users/2/password -H "Authorization: Bearer $ADMIN" \
  -d '{"newPassword":"fresh-pass-123"}'
```

A read-only WebSocket event stream (deploys, domains, databases, backups, users) is available at `wss://<host>/v1/events?token=<token>` — the dashboard's Activity drawer consumes it.

## Development

```bash
pnpm dev         # server + web in watch mode (migrations apply on startup)
pnpm build       # production build
pnpm typecheck   # type-check the monorepo
pnpm test        # full test suite — every package has a 100% coverage gate
pnpm db:generate # generate migration from schema changes
pnpm db:studio   # open Drizzle Studio
pnpm clean       # remove dist and node_modules
```

CI runs typecheck, build, the full test suite (100% coverage gated), advisory lint, and a Docker image build on every PR; releases publish the image to GHCR on tags. Integration tests (real PostgreSQL/MySQL/Redis/MongoDB via testcontainers + an end-to-end deploy pipeline run) live under `apps/server/test/integration/` and run with `RUN_INTEGRATION=1` (the deploy e2e additionally requires a host-routable Docker bridge — Linux/CI).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system diagram, deploy pipeline, and design decisions.

## License

MIT — see [LICENSE](./LICENSE).
