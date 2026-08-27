# NineDeploy — Architecture

> **Doc status.** Written against the tree at `v0.3.5`. Every count in it
> (tables, migrations, routes, tests, templates) was read out of the source, not
> carried over from a previous revision. Where the implementation does not yet
> match the intent, that is stated in the text rather than smoothed over — see
> [§16 Known gaps](#16-known-gaps-implementation-vs-intent), which is part of the
> architecture, not an appendix to it. Five of those gaps were closed in 0.3.5
> (§16.1, §16.2, §16.4, §16.5, §16.7); the rest are still open and marked as
> such.

A self-hosted deployment platform with optional multi-server support. The core
server runs bare-metal (systemd) for direct PM2 + Docker daemon access; a
container image is also published for Docker-based installs (host socket
mounted, `DOCKER_GID` supplied so the non-root image user can reach it). Remote
hosts run the same binary in agent mode (`NINEDEPLOY_AGENT=1`) and execute a
fixed table of typed, validated operations for the core. App containers live on
a shared Docker network (`ninedeploy`); Traefik is the intended sole public
listener on :80/:443, with an explicit, operator-gated escape hatch for direct
host port publishing (`services.published_port`).

- **Runtime**: Node ≥ 22.13, pnpm 11 workspace, Turborepo (`turbo run build/dev/lint/typecheck/test/clean/db:*`)
- **Language**: TypeScript 7 strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`), Biome for lint/format
- **Testing**: Vitest 4 + `@vitest/coverage-v8`, Testing Library. Server: 183 files / 2 472 tests, green. Monorepo: 3 355 tests across 308 files, all green. Coverage gates are **tiered**, not uniformly 100 — see [§13](#13-testing)

## 1. System diagram

```
                        ┌──────────────────────────────────────────────────┐
                        │            NineDeploy Core (Fastify 5)            │
                        │            apps/server (systemd or image)         │
   User ──────── WebUI ─┤                                                  │
   (React 19+Vite)      │  ┌───────────────┐  ┌────────────────────────┐   │
   CLI ─────────────────┤  │ Auth          │  │ Deploy Engine           │   │
   (commander 15)       │  │ JWT+sessions  │  │  Git clone → Insights    │   │
   MCP ─────────────────┤  │ API tokens    │  │  → Manifest → Deps      │   │
   (stdio, 36 tools)    │  │ Passkeys/TOTP │  │  → Build → Run → Health │   │
   SDK ─────────────────┤  │ OIDC SSO      │  │  → Proxy swap → Cleanup │   │
                        │  ├───────────────┤  ├────────────────────────┤   │
                        │  │ Workspaces    │  │ Builders                │   │
                        │  │ members/invites│ │  ├─ Docker (buildx/     │   │
                        │  │ labels, tags  │  │  │   nixpacks, blue-green)│  │
                        │  ├───────────────┤  │  ├─ PM2 (host process)  │   │
                        │  │ Secrets       │  │  └─ Compose (ndcmp-)    │   │
                        │  │ AES-256-GCM   │  ├────────────────────────┤   │
                        │  │ key ring      │  │ Database Engine          │   │
                        │  ├───────────────┤  │  PG/MySQL/Redis/Mongo/  │   │
                        │  │ EventBus      │  │  Valkey/ClickHouse      │   │
                        │  │ (lib/events)  │  │  + volumes + backups    │   │
                        │  │ WS push to UI │  │  + Studio containers    │   │
                        │  ├───────────────┤  ├────────────────────────┤   │
                        │  │ Microkernel   │  │ Fastify plugins          │   │
                        │  │ (inert — §16) │  │  worker · traefik ·     │   │
                        │  │ registry/hooks│  │  collector · schedulers │   │
                        │  │ configCenter  │  │  housekeeping · runtime │   │
                        │  │ menuRegistry  │  │  State · rateLimit ·    │   │
                        │  │ pluginLoader  │  │  rawBody · secHeaders   │   │
                        └──┬──────┬──┬──────┴──┴────────────────────────┴───┘
                           │      │  │
              ┌────────────▼┐  ┌──▼───────────────┐  ┌─────────────────────┐
              │  Traefik v3 │  │ SQLite (.data/)   │  │ Remote agents       │
              │  :80 / :443 │  │ libsql + Drizzle  │  │ (NINEDEPLOY_AGENT=1)│
              │  auto-HTTPS │  │ 40 tables         │  │ typed ops, plain    │
              │  middlewares│  │ self-migrating    │  │ HTTP transport §7   │
              └──────┬──────┘  └───────────────────┘  └──────────┬──────────┘
                     │
          ┌──────────┼──────────────────────────┐
          ▼          ▼                          ▼
   ┌────────────┐  ┌────────────┐  ┌────────────────────┐
   │ App        │  │ App        │  │ Database           │
   │ (PM2 on    │  │ (Docker /  │  │ containers         │
   │  host)     │  │  Compose)  │  │ + named volumes    │
   └────────────┘  └────────────┘  └────────────────────┘
          │          │                          │
          └──────────┴── ninedeploy network ────┘
             (Traefik resolves containers by name)
```

## 2. Monorepo structure

```
ninedeploy/                       pnpm 11 workspace + Turborepo
├── apps/
│   ├── server/                    Fastify 5 API + deploy engine (163 .ts files)
│   │   ├── src/
│   │   │   ├── engine/     (~4.9k LOC) pipeline, builders (docker/pm2/compose),
│   │   │   │               database, proxy, tunnel, logs, containerFiles,
│   │   │   │               volumeFiles, logDrainManager, autoPrune, magicVars,
│   │   │   │               repoInsights, templateDependencies, serverProvisioner
│   │   │   ├── modules/    (~10.8k LOC) 51 route modules — see §5
│   │   │   ├── lib/        (~7.2k LOC) crypto, jwt, sessions, totp(+replay),
│   │   │   │               webauthn, oauth/OIDC, loginLockout, passwordReset,
│   │   │   │               keyRotation, resourceAccess (authz choke point),
│   │   │   │               hostPrivilege, hostPort, egressGuard, gitEgress,
│   │   │   │               agentClient, spawnValidated, exec, git, vault,
│   │   │   │               s3, backupRemote, cloudflare, firewall, frameworks,
│   │   │   │               ninedeployManifest/-Apply/-ToNixpacks, selfUpdate
│   │   │   ├── kernel/     (~2.0k LOC) microkernel: EventBus, HookPipeline,
│   │   │   │               ServiceRegistry, ConfigCenter, MenuRegistry,
│   │   │   │               pluginLoader + 3 built-in plugins  ⚠ see §16.3
│   │   │   ├── plugins/    (~1.2k LOC) fastify plugins — see §6
│   │   │   ├── templates/  89-entry registry bundle + Coolify compose mirror
│   │   │   ├── agent.ts    remote-host agent mode
│   │   │   └── version.ts  VERSION + changelog
│   │   ├── scripts/        buildTemplateMirror.ts (compose→template converter)
│   │   ├── test/           183 unit/route files, 2 472 cases
│   │   └── test/integration/  testcontainers (real PG/MySQL/Redis/Mongo/
│   │                          Valkey/ClickHouse + deploy e2e), RUN_INTEGRATION=1
│   │
│   ├── web/                       React 19.2 + Vite 8 + Tailwind v4 (~29.6k LOC)
│   │   ├── src/routes/            27 top-level pages + service/ (16 tabs & cards),
│   │   │                          settings/ (12 sections), manifestCreator/
│   │   │                          (15 section editors), database/
│   │   ├── src/components/        24 components: Layout, DeployWizard,
│   │   │                          DatabaseWizard, NotificationWizard,
│   │   │                          CommandPalette, ContainerTerminal,
│   │   │                          ContainerFileBrowser, VolumeBrowser,
│   │   │                          VolumeBackupsPanel, TopBarFilters,
│   │   │                          WorkspaceSwitcher, PipelineStepper, ui.tsx
│   │   └── src/lib/               api (SDK + 401→refresh→retry), auth, workspace,
│   │                              projects, mode (simple/advanced), theme,
│   │                              useDeployLogs, usePanelUpdate, cron, autofill
│   │
│   └── cli/                       `ninedeploy` CLI — 40+ commands (commander 15)
│
├── packages/
│   ├── db/          Drizzle ORM schema (40 tables) + 37 SQL migrations;
│   │                server self-migrates at startup (drizzle-kit is dev-only)
│   ├── schemas/     Zod v4 DTOs shared by server, web, CLI, SDK, MCP
│   ├── sdk/         Typed API client over an injectable FetchLike; 40+ namespaces
│   ├── plugin-sdk/  definePlugin + scopedConfig helpers for kernel plugins
│   └── mcp/         MCP server (`ninedeploy-mcp`, stdio) — 36 tools
│
├── website/                       Marketing + docs site
├── docs/                          11 operator guides (QUICKSTART, DEPLOYMENTS,
│                                  WORKSPACES_RBAC, NINEDEPLOY_MANIFEST,
│                                  PLUGINS_MICROKERNEL, TRAEFIK_INGRESS, …)
├── .github/workflows/             ci.yml (typecheck/lint/build/test/schema-drift/
│                                  deprecated-deps/image build/integration),
│                                  release.yml, website.yml
├── Dockerfile                     multi-stage; docker CLI + git + tini +
│                                  checksum-pinned Nixpacks 1.41.0; non-root
├── docker-compose.yml             development environment
├── docker-compose.prod.yml        standalone container install (DOCKER_GID)
├── systemd/                       ninedeploy.service unit
├── install.sh                     1 458-line one-click installer
└── ARCHITECTURE.md                This file
```

## 3. Clients

Four first-class clients consume the same REST API (`/v1`) through the shared
typed SDK and Zod schemas:

- **Web** (`apps/web`) — React 19 dashboard; server state via TanStack Query 5,
  no Redux/Zustand (local state is React context only: auth, workspace,
  projects, theme, experience mode). Realtime is purpose-specific: deploy log
  streaming over `WS /v1/services/:id/deployments/:id/logs` (backlog replay +
  live tail), a container exec terminal over `WS /v1/services/:id/exec`
  (xterm.js, binary frames), and a global audit stream over `WS /v1/events`.
  Auth is JWT access+refresh in localStorage with a single-flight
  401→refresh→retry fetch wrapper. A **simple/advanced experience mode**
  (`lib/mode.tsx`, default *simple*) hides advanced nav and controls
- **CLI** (`apps/cli`) — `ninedeploy` (commander 15); token stored 0600 in
  `~/.ninedeploy/config.json`; WebSocket log streaming via `ws`. Commands cover
  login/setup, services, deploys, logs, env, domains, databases, backups,
  volumes, networks, sources, webhooks, workspaces, users, sessions, alerts,
  firewall, plugins/marketplace, config-center, templates, system/prune,
  update-check, manifest `init`/`validate`, `doctor`, `demo seed`
- **MCP** (`packages/mcp`) — Model Context Protocol server (stdio). **36 tools**:
  read-only inspection (`list_services`, `get_service`, `service_logs`,
  `list_deploys`, `list_domains`, `list_databases`, `list_projects`,
  `list_workspaces`, `get_workspace`, `list_alerts`, `activity_log`,
  `system_stats`, `topology`, `health`, `list_log_drains`, `list_menus`,
  `list_configs`, `get_config`, `inspect_container`, `list_container_files`,
  `get_container_compose`, `list_plugins`, `marketplace_plugins`), guarded
  actions (`deploy_service`, `restart_service`, `rollback_deploy`,
  `update_service`, `system_autoprune`, `seed_demo`), and configuration writes
  (`set_config`, `delete_config`, `install_plugin`, `enable_plugin`,
  `disable_plugin`, `uninstall_plugin`). Authenticated with an API token via
  `NINEDEPLOY_URL` / `NINEDEPLOY_TOKEN`.
  ⚠ The MCP surface is **wider than read-only**: an MCP token can mutate config
  and services. Scope it accordingly (see §16.5 on token scopes)
- **Anything else** — the REST API is Zod-documented; the SDK
  (`createClient({ baseUrl, token, fetch? })`) exposes typed namespaces with a
  `NineDeployError` type and injectable fetch

## 4. Database schema (40 tables, migrations 0000–0038)

Storage: **SQLite** via `@libsql/client` (dialect `turso`, local file
`.data/ninedeploy.db`). PRAGMAs at boot: `foreign_keys=ON`,
`busy_timeout=5000`. WAL is deliberately **off** — the system export handler and
`install.sh`'s pre-update backup tar the single db file, and a WAL sidecar would
silently drop recently committed state from those archives
(`packages/db/src/client.ts`).

### 4.1 Identity, teams and access

```
users                  id, email, password_hash, name, token_version
                       (JWT revocation counter), totp_secret_encrypted,
                       totp_enabled, totp_last_step, is_instance_operator.
                       NOTE: the global `role` column is GONE. Team access is
                       workspace-derived; instance-operator rights are the
                       explicit flag above, never inferred (§8.1)
sessions               id, user_id, jti (unique), ip, user_agent, last_used_at,
                       expires_at, revoked_at — one row per refresh token
api_tokens             id, user_id, name, hash(sha256), scopes, last_used_at,
                       expires_at — `scopes` is enforced in plugins/auth.ts
                       (read | write | operator; empty = legacy unrestricted)
webauthn_credentials   id, user_id, credential_id, public_key, counter,
                       transports, name — passkeys
password_reset_tokens  id, user_id, token_hash, expires_at, used_at, requested_from
workspaces             id, name, slug, description, owner_id
workspace_members      id, workspace_id, user_id, role(owner|admin|member|viewer)
workspace_invitations  id, workspace_id, email, role, token, expires_at, accepted_at
oidc_providers         id, name, slug, issuer_url, client_id,
                       client_secret_encrypted, scopes, enabled, auto_enroll,
                       default_role
```

### 4.2 Scoping (N-N, replaces the old single `services.project_id`)

```
projects            id, name, slug, description, workspace_id
labels              id, workspace_id (nullable = global), name, color
service_projects    (service_id, project_id)   PK pair
service_workspaces  (service_id, workspace_id) PK pair
service_labels      (service_id, label_id)     PK pair
```

The top-bar filter composes the three dimensions: ids **OR** within a group,
groups **AND** across each other (`?tagWorkspaceIds=1,2&tagProjectIds=3`).

### 4.3 Services and delivery

```
services       id, owner_user_id, name, slug, type(docker|pm2|compose),
               status(idle|deploying|running|stopped|error|deleting),
               repo_url, branch, commit_sha, source_id, server_id, image,
               volume_mount, port, published_port, health_path, runtime_id,
               cpu_shares, mem_limit_mb, cmd(json), docker_socket,
               template_id, template_database_env(json), compose_service,
               preview_deployments_enabled, preview_auto_destroy_on_close,
               preview_domain_pattern, preview_max_active,
               is_ephemeral_preview, preview_parent_service_id, pr_number
build_configs  id, service_id, build_pack(auto|nixpacks|dockerfile), base_dir,
               install/build/start_cmd, dockerfile_path,
               pre_deploy_cmd, post_deploy_cmd, pre_stop_cmd,
               restart_policy, stop_grace_seconds
deployments    id, service_id,
               status(queued|building|deploying|running|superseded|failed|cancelled),
               commit_sha, image_digest (exact rollback pin), config_snapshot,
               message, author, trigger(user|webhook|cli|schedule), log_path,
               started_at, finished_at
env_vars       id, service_id, key, value_encrypted, is_secret
repo_insights  id, service_id, framework_id, data(json) — framework analysis
sources        id, type(github|gitlab|gitea|bitbucket|custom|registry), name,
               token_encrypted, deploy_key_encrypted, registry_username
webhooks       id, source_id, service_id, branch, events, secret_encrypted,
               active, watch_paths (monorepo path globs)
domains        id, service_id, hostname, path, ssl, redirect_www, status,
               headers, basic_auth, ip_allowlist, rate_limit_average,
               rate_limit_burst
tunnels        id, name, slug, token_encrypted, status, container_name
```

### 4.4 Data services, storage and operations

```
databases              id, project_id, owner_user_id, name, slug, engine,
                       version, status, container_name, internal_host,
                       internal_port, username, password_encrypted, db_name,
                       volume_name, cpu_shares, mem_limit_mb
database_attachments   id, service_id, database_id, env_alias
service_volume_attachments  id, service_id, volume_name, mount_path, read_only
backups                id, database_id, scope(db|scheduled|volumes|full), status,
                       path, size_bytes, remote_key, labels
backup_destinations    id, name, endpoint, region, bucket, prefix,
                       access_key_id, secret_key_encrypted, active
log_drains             id, name, type, endpoint, active — external log shipping
metrics                id, service_id, kind(cpu|memory), value, ts
audit_log              id, user_id, action, entity, meta(json), ts
settings               key, value(json)
config_entries         key, value, is_secret, category, plugin_id — Config Center
installed_plugins      id, name, version, enabled, manifest(json), is_official
notification_channels  id, name, type(telegram|webhook|discord|slack|ntfy|email),
                       target_encrypted, event_filter, active
notification_log       id, channel_id, event, entity, status, attempts, error, ts
alert_rules            id, service_id (null = host-wide),
                       metric(cpu|memory|cert-expiry), operator, threshold,
                       duration_windows, enabled
alert_state            rule_id (unique), status(ok|breaching|firing),
                       breach_since, fired_at, last_notified_at, last_value
scheduled_jobs         id, service_id, name, cron(5-field),
                       kind(deploy|exec|backup), command, enabled, last_run_at
job_runs               id, job_id, status, output, exit_code, started/finished_at
servers                id, name, host, port, status(offline|online|error|pending),
                       token_encrypted, last_seen_at
```

### 4.5 Migration history

`packages/db/src/migrations/`, drizzle-kit generated, forward-only and additive.
38 journalled migrations, `0000` → `0038`. **`0020` does not exist** — the tag
was skipped; the journal (`meta/_journal.json`) is authoritative and does not
reference it, so this is cosmetic.

Notable later migrations: `0024` domain middlewares · `0025` extended databases ·
`0026` lifecycle hooks + preview deployments · `0027` workspaces + OIDC ·
`0028`/`0029` template database env + durable template recovery · `0030` TOTP
replay + enrolment · `0031` repo insights · `0032` workspace invitations ·
`0033` service volume attachments · **`0034` tags & team overhaul** (drops
`services.project_id` and the global `users.role`; introduces the three N-N join
tables) · `0035` volume backups · `0036` `databases.owner_user_id` ·
`0037` volume backup labels · **`0038` `users.is_instance_operator`** (separates
instance-operator rights from workspace roles — see §8.1).

The runtime migrator (`packages/db/src/migrate.ts`) additionally tolerates
"object already exists" failures by re-applying statement-by-statement — this
exists because releases up to 0.2.36 patched columns in at boot outside the
journal, and a batch migrator would abort the whole upgrade on those installs.

## 5. Server request lifecycle

`server.ts` → `buildApp()` (`app.ts`): listen and handle graceful SIGINT/SIGTERM
shutdown. Registration order:

```
cors → websocket → securityHeaders → rateLimit → rawBody → db → kernel → auth
  → error handler → health → events(WS) → /v1 (51 route modules)
  → worker → traefik → runtimeState → collector → backupScheduler
  → housekeeping → jobScheduler → staticFiles (SPA catch-all, LAST)
```

Body limit 256 MB (system import tarballs). CORS allowlist (`publicUrl`, dev
ports, `NINEDEPLOY_CORS_ORIGINS`). Zod failures map to `400 validation_error`
envelopes; 5xx messages are suppressed in production.

### 5.1 Route modules

| Module | Prefix | Routes |
|---|---|---|
| auth | /auth | setup, register (gated), login (lockout + TOTP), passkey register/login, sessions list/revoke, forgot/reset password, 2FA setup/enable/disable, refresh (jti-enforced), logout, password, me, status, API tokens CRUD, **OIDC provider CRUD + SSO start/callback** |
| workspaces | /workspaces | workspace CRUD, member add/role-update/remove, ownership transfer |
| invitations | /workspaces, / | invite create/list/revoke; public token lookup + authenticated accept |
| users | /users | list, password reset, one-time reset link, delete — operator-only |
| projects | /projects | project CRUD (workspace-scoped) |
| labels | /labels | label CRUD (workspace-scoped or global) |
| serviceTags | /services/:id/tags | GET/PUT the service's project/workspace/label tag sets |
| services | /services | CRUD, update (incl. build config PATCH), stop/start/restart, limits, logs, export/import |
| deploys | /services/:id/deploys | trigger, list, rollback, cancel, config diff vs previous, WS logs, WS exec (operator-only, audited) |
| serviceVolumes | /services/:id/volumes | named-volume attachments CRUD + config-repair |
| serviceMigration | /services/:id/export+import | per-service bundle, server-to-server moves |
| insights | /insights, /services/:id/insights | repo framework analysis + on-demand refresh |
| domains | /services/:id/domains | add (Cloudflare record auto-provision + ownership proof), list, remove, per-domain SSL / headers / basicAuth / IP allowlist / rate limit |
| domainIndex | /domains | list all (scoped), SSL toggle |
| databases | /databases | CRUD, limits, wizard, credentials (operator), **Studio container start/stop** |
| databaseBackup | /databases/:id | storage, backups, restore (ownership-checked) |
| backups | /backups | list, delete (incl. remote object), download |
| backupDestinations | /backup-destinations | S3-compatible CRUD + connectivity test |
| volumes | /volumes | inventory, delete, browse |
| volumeBackups | /volumes/:name/backups | snapshot create/list/restore/download (labelled) |
| containers | /containers/:name | inspect, compose, file browser (list/read/write/mkdir/delete) |
| env | /services/:id/env, /projects/:id/env, /env/search | service + project-scope env CRUD, cross-scope key search |
| hooks | /hooks, /services | receive (HMAC + branch + watch-path globs + replay dedup + **PR preview create/destroy**), manage CRUD; public, rate-limited |
| templates | /templates | list, detail, deploy — schema-validated registry (89 entries; bundled JSON, DB/env source override with 6 h cache + offline fallback) |
| topology | /topology | graph (services + DBs + domains + attachments) |
| stats | /stats, /services/:id/metrics | live snapshot, time series |
| dashboard | /dashboard | aggregate stats + health probes + recent |
| sources | /sources | CRUD (PAT, deploy keys, registry creds) |
| tunnels | /tunnels | CRUD (cloudflared) |
| networks | /networks | list with members, create/delete, container attach/detach (local + typed-agent remote) |
| traefik | / | status, certificates, logs, config, restart, backup-certs, version, update |
| firewall | /firewall | UFW status, toggle, rule CRUD, recommended ruleset |
| resources (system) | /system | resources, docker-events feed, prune-images, **update-check / update-status / update-start (self-update)**, export, import (tar-slip guarded, rollback) |
| housekeeping | /housekeeping | prune config get/patch, manual prune |
| jobs | /services/:id/jobs | cron deploy/exec/backup jobs, run-now, run history |
| servers | /servers | remote agent registry, one-time token on register, connectivity test (one deliberately unauthenticated write: agent self-announce) |
| logDrains | /log-drains | CRUD + test |
| settings | /settings | registration toggle, ACME email, template source, DNS-01, vault provider (Infisical/Doppler), Cloudflare DNS |
| configCenter | /config | typed config entries get/set/delete with secret reveal |
| plugins | /plugins | list, marketplace, install, uninstall, enable, disable, inspect, reload  ⚠ §16.3 |
| menus | /menus | plugin-contributed nav items (consumed by `Layout.tsx`) |
| notifications | /notifications | channels CRUD, test, delivery log |
| alerts | /alerts | alert rule CRUD + state |
| activity | /activity | audit log feed |
| about | /about | version, changelog, tech stack (public); counts when authenticated |
| demo | /demo | seed demo data |
| health | /health | liveness + DB ping (public) |
| events | /v1/events (WS) | global real-time audit stream (backlog replay, per-user delivery scoping) |

## 6. Fastify plugins

| Plugin | Function |
|---|---|
| securityHeaders | CSP / frame / referrer / nosniff response headers |
| rateLimit | Global + per-route IP rate limiting (auth/setup/webhook tighter) |
| rawBody | Captures raw body for HMAC + binary uploads |
| db | Decorates `fastify.db`; enables PRAGMAs; **applies pending migrations via the runtime migrator** |
| kernel | Instantiates the microkernel, registers drivers + 3 built-in plugins, loads DB-installed plugins on `onReady` ⚠ §16.3 |
| auth | `authenticate` (JWT access or API token; `isOperator` recomputed per request) + `requireOperator` / `requireAdmin` (alias) |
| worker | Polls queued deployments (2 s) and runs the pipeline. Claims are atomic (`queued→building` verified via rowsAffected) and skip services already `building`. Concurrency is **partitioned per target server**, each partition getting `NINEDEPLOY_DEPLOY_CONCURRENCY` slots (default 1, max 8). Sweeps `building` rows older than 45 min back to `queued` on boot; 60 s stop grace |
| traefik | Ensures `ninedeploy` network + Traefik v3.3 container (config **directory** bind mount) + writes dynamic config atomically; DNS-01 when a provider+token are configured, else HTTP-01 |
| runtimeState | Reconciles panel status against live containers/processes |
| collector | Samples container + host stats every 30 s → metrics table; prunes metrics older than 24 h; feeds the alert evaluator (cpu %, memory MiB, host, cert-expiry days) |
| backupScheduler | Daily database backups (`scheduled` scope), keeps last 7 per DB — never prunes manual backups; pushes to S3-compatible destinations via the dependency-free SigV4 client |
| housekeeping | Hourly retention: deploy logs (30 d), audit log (90 d), notification log (30 d), expired reset tokens (24 h), dangling Docker images |
| jobScheduler | Cron-scheduled per-service jobs via croner; re-reads the jobs table every 5 min; run history in `job_runs` |

## 7. Deploy engine

Everything goes through the **Docker CLI** via validated spawn — no dockerode.
All process spawning funnels through `lib/spawnValidated.ts` (operand regexes,
arg-array exec, never a shell string); `lib/exec.ts` adds hard timeouts +
tree-kill (SIGTERM→SIGKILL) and a whitelisted env inheritance (never
`NINEDEPLOY_*`).

### 7.1 Pipeline (`engine/pipeline.ts`)

```
 1. Trigger (manual / webhook / CLI / cron job / template) → deployment row (queued);
    a [skip ci]/[skip cd] head-commit marker skips webhook auto-deploys
 2. A worker slot claims it atomically → status: building. The row stores a
    config snapshot (build config + env-key fingerprint — values never),
    powering the per-deploy config diff
 3. Crash recovery: `building` rows older than 45 min are requeued on boot
 4. PREPARE — image deploy: pull (rollback pins an exact digest).
    Repo deploy: resolve source creds → checkout commit (token/SSH key
    scrubbed) → framework analysis into `repo_insights` (best-effort)
    → load `.ninedeploy` manifest and apply its OPERATIONAL sections
      (routes, database, alerts). The build-shaping sections are folded in at
      step 8 under `panel > manifest > auto-detect` (§16.2)
 5. DEPENDENCIES — for template services, reconcile managed DB dependencies
    idempotently (durable via `services.template_id`)
 6. Gather env: project-scope shared vars ← service vars ← attached-DB
    connection strings / template `databaseEnv` mapping (later wins), then
    resolve ${{infisical:KEY}} / ${{doppler:KEY}} vault refs at deploy time
    (never stored; a missing key fails the deploy). Registry auth from
    registry-type sources. A deploy fails if any attached DB is not running
 7. Pre-deploy hook (if configured) — runs on the HOST
 8. BUILD — the manifest's `build`/`run`/`resources` fill in whatever the panel
    left empty, `env.required` gaps become warnings, and `runtime`/`phases` are
    rendered into a `nixpacks.toml`. Then builder dispatch: Docker (Dockerfile
    via buildx, or Nixpacks for Dockerfile-less repos) / PM2 (install + build
    with the service env) / Compose (`docker compose up -d --build`, prefix
    ndcmp-)
 9. BOOT — start the NEW runtime with env-file secrets (0600 temp file, deleted
    after start) + network + volume attachments + limits + restart policy.
    The previous Docker container keeps serving (blue-green)
10. HEALTHCHECK — container alive (docker inspect) AND HTTP probe against the
    container's network IP (fresh per attempt, per-attempt AbortSignal; up to
    5 min). Post-deploy hook afterwards (failure is a warning, not fatal)
11. SUCCESS (outside the try — a post-success hiccup can never kill the healthy
    container): finalize the deployment row conditionally on still being
    `building` (a late cancel wins), warn on managed-env value drift, persist
    the image digest, demote older `running` rows to `superseded`, auto-assign
    the wildcard domain, flip Traefik routing, and ONLY THEN (after a 2 s
    settle) run the pre-stop hook and retire the previous container
12. FAILURE — stop the NEW runtime; if the previous is still healthy (Docker
    blue-green), the service keeps serving it and only the deployment is marked
    failed. PM2 has no previous (stop-then-start), so it goes down
13. CANCEL — the pipeline re-reads the row status at every checkpoint and tears
    down the partial runtime (`DeploymentCancelled`). In-place compose
    redeploys are detected and NOT torn down (their id is the live instance)
14. REMOTE — services with `server_id` run the same pipeline; the BuildContext
    carries an `agentCall` and the builder executes typed ops over agentClient
15. Every subprocess has a hard timeout + tree-kill. Audit + EventBus +
    notification dispatch throughout; logs stream over WebSocket and persist to
    disk (engine/logs.ts LogBus), stage-tagged as `##[stage:NAME:state]`
```

### 7.2 Builders

- **docker.ts** — build (Dockerfile or Nixpacks) + run on the shared
  `ninedeploy` network, secrets via 0600 temp env-file, healthchecks against
  container IPs. Optional `-p published_port:container_port` host publish
  (operator-gated, reserved ports refused). Blue-green switch + auto rollback
- **pm2.ts** — Node runtime managed by PM2 on the host, stop-then-start (brief
  gap, auto-rollback on failure). Host-privileged — operator-only
- **compose.ts** — `docker compose up -d --build` with the `ndcmp-` project
  prefix; no blue-green (compose controls the lifecycle). Host-privileged —
  operator-only

### 7.3 Reverse proxy (`engine/proxy.ts`)

Traefik v3.3 as the intended sole exposed container (:80/:443), shared
`ninedeploy` network, atomic dynamic-config writes (temp+rename, directory bind
mount — a single-file mount would pin the inode and never see renames), strict
sanitizing of Host/Path rule operands (anti rule/YAML injection). Per-domain
middlewares: www→apex redirect, custom response headers, basicAuth,
`ipAllowList`, `rateLimit`. ACME email + DNS-01 wildcard support from settings;
certificate expiry is parsed out of `acme.json` and fed to the alert evaluator.

## 8. Auth, RBAC and account security

- **JWT** (jose, HS256): access 15 m + refresh 7 d; `ver` claim matched against
  `users.token_version` — logout, password change/reset bump it, revoking every
  outstanding session statelessly
- **Sessions**: every refresh token carries a `jti` referencing a live row (ip,
  user agent, last used, expiry, revoked). `/auth/refresh` enforces the row on
  every rotation, so one device can be signed out without touching others
- **Passkeys**: WebAuthn registration + passwordless login via
  `@simplewebauthn/server`; RP derives from the public URL hostname, challenges
  are single-use with a 5-minute TTL, signature counters track clone detection
- **API tokens**: opaque, sha256-hashed at rest, optional expiry +
  `last_used_at`, and **enforced scopes** (`read` / `write` / `operator`) applied
  centrally in `plugins/auth.ts`. A scope can only narrow the owner's authority;
  an empty list is a pre-0.3.5 token and stays unrestricted (§16.5)
- **2FA**: dependency-free RFC 6238 TOTP, secret encrypted at rest; codes are
  **consumed**, not just verified, so a replay inside the drift window fails
- **SSO**: OIDC providers (`oidc_providers`), auto-enrolment into a personal
  workspace with a configurable default workspace role
- **Passwords**: Argon2id; self-service change + operator reset + single-use
  30-minute reset links
- **Lockout**: in-memory per-account — 5 consecutive failures → 15 min lock, on
  top of per-IP rate limits
- **Registration gate**: `allow_registration` (default **off**); bootstrap
  (zero users) always permitted
- **WebSocket auth**: auth subprotocol header, with `?token=` back-compat (query
  strings are stripped from request logs)

### 8.1 The authorization model — and its central weakness

`lib/resourceAccess.ts` is the single authorization choke point. The intended
model is workspace-scoped:

- **service** → caller is a member of a workspace the service is tagged into,
  or is the service's `owner_user_id`
- **project** → caller is a member of the project's workspace; a NULL-workspace
  project is operator-only
- **database** → `owner_user_id` match, or membership of the owning project's
  workspace

Above that sits **`isOperator`**, read from the dedicated
`users.is_instance_operator` column and recomputed on every request. It bypasses
every resource loader and gates every system-wide route (`requireOperator`,
aliased `requireAdmin`): users, OIDC, system import/export, self-update, volumes,
sources, tunnels, firewall, config center, plugins, containers/file browser,
database credentials, exec, backups.

It also gates the **host-privilege boundary** (`lib/hostPrivilege.ts`): PM2
services, Compose deploys, pre/post/pre-stop lifecycle hooks and
`docker_socket` templates all execute code on the host and are therefore
operator-only — as is publishing a privileged host port (`lib/hostPort.ts`).

The flag is **deliberately not derived from workspace membership**. Until 0.3.4
`isOperator` meant "holds `owner`/`admin` in at least one workspace"; because
`POST /v1/workspaces` has no role gate and inserts the caller as `owner` (and
`GET /v1/workspaces` auto-creates an owned workspace for a user with no seats),
any authenticated user could promote themselves to full instance operator with
one request — and, through the host-privilege boundary, reach arbitrary code
execution on the host. Migration `0038` moved the flag onto the user row:

- the bootstrap user (first `/setup`, first `/auth/register`, or the first SSO
  auto-enrolment on an empty instance) receives it;
- everyone else is granted it explicitly by an existing operator via
  `PATCH /v1/users/:id/operator` (Settings → Users);
- the last remaining operator cannot be demoted or deleted;
- creating a workspace confers nothing at instance level.

`test/operatorEscalation.test.ts` pins this against a real database — it fails
against the pre-0.3.5 implementation.

Within a workspace, the four roles are a real hierarchy
(`owner > admin > member > viewer`) enforced by `assertWorkspaceRole` and, for
service-scoped writes, **`assertServiceRole`**. The effective role on a service
is the highest seat the caller holds across the workspaces that service is
tagged into, with the service's `ownerUserId` and the operator flag both
counting as `owner`. The convention across the routes is:

| Action | Required |
|---|---|
| read a service, its deploys, logs, env keys | any seat (incl. `viewer`) |
| deploy, rollback, cancel, restart/stop/start | `member` |
| edit the service or build config, write env, manage domains, set limits | `member` |
| delete the service, re-tag it into other workspaces | `admin` |
| host-privileged shapes (PM2, compose, lifecycle hooks, docker socket), instance-wide routes | instance operator |

## 9. Multi-server (agent mode)

Remote hosts run the same server binary with `NINEDEPLOY_AGENT=1`, which boots a
minimal HTTP agent instead of the full API (`src/agent.ts`, `src/agentApp.ts`):

- Registered in the `servers` table via a one-time token (printed once); the
  shared token is stored encrypted and compared as sha256 (timing-safe).
  `last_seen_at` tracks health; connectivity is testable from the Servers page.
  An agent may also self-announce to `NINEDEPLOY_MASTER_URL` — this is the one
  deliberately unauthenticated write in the product
- The core talks to agents through `lib/agentClient.ts` → `POST /agent/exec`
  with a **typed operation name** from a fixed table (~24 ops: docker
  pull/build/run/runEnv/stop/rm/inspect/logs/login/logout, network
  create/rm/connect/disconnect, compose up/down, git
  clone/fetch/checkout/rev-parse/reset, file writeEnv/deleteEnv), never a
  program name or raw argv
- Every operand (names, paths, URLs, refs, SHAs) is validated by strict regexes
  on both ends; all spawning funnels through `lib/spawnValidated.ts`
- ⚠ **Transport is plain `http://`** with no TLS option. The agent token and —
  via `file.writeEnv` — the service's decrypted secrets cross the network in
  cleartext. Agents must therefore be treated as same-LAN/VPN-only today (§16.6)

## 10. Scoping: workspaces, projects, labels

Three independent, optional tag dimensions replace the old single-parent
project hierarchy (migration `0034`):

- **Workspace** — the team/tenancy unit. Carries membership and roles
- **Project** — a grouping inside (or across) workspaces
- **Label** — free cross-cutting tagging ("production", "team-x"), workspace-
  scoped or global

A service may belong to many of each. The web UI keeps the active workspace in
`lib/workspace.tsx` (localStorage-persisted) and the composed tag filter in the
top bar; the API accepts `?tagWorkspaceIds=&tagProjectIds=&tagLabelIds=`.

All list endpoints share one visibility rule — `visibleServiceIdSet` in
`lib/resourceAccess.ts`: owned services ∪ services tagged into a workspace the
caller belongs to, unrestricted for instance operators. `GET /v1/services`,
`/dashboard`, `/domains` and the per-service loader used to disagree, so a
teammate could deploy a shared service by id but never saw it in their own list
(§16.7).

## 11. Web UI

- **Stack**: React 19.2 + react-router 8, Vite 8, Tailwind CSS v4 (CSS-first
  `@theme`, no tailwind.config), TanStack Query 5, xterm.js 6, @xyflow/react 12,
  lucide-react
- **Theming**: dark/light via `data-theme` + 6 accent colors via `data-accent`;
  persisted in localStorage; dark + indigo default
- **Experience mode**: `simple` (default) vs `advanced` — hides advanced nav
  groups and controls for first-time operators
- **Layout**: icon rail with collapsible groups + secondary panel, workspace
  switcher, top-bar tag filters, Ctrl-K CommandPalette, panel self-update banner
- **Service Detail** (`routes/service/`) — tabs: **Overview** (status header,
  live CPU/memory sparklines, runtime metadata, deployment history with
  rollback, WS live deploy logs, runtime log tail, exec terminal), **Deploys**
  (live WS logs, rollback, cancel, config diff, `PipelineStepper` stage view),
  **Environment** (env vars with write-only secrets, DB attachments, webhooks
  with one-time secret reveal, cron jobs), **Network** (domains, per-domain SSL,
  basicAuth, IP allowlist, rate limit), **Volumes** (named-volume attachments +
  browser + backups), **Framework** (repo insights), **Manifest**
  (`.ninedeploy` view), **Architecture**, **Settings** (service fields, build
  config incl. lifecycle hooks and restart policy, limits, preview deployments),
  **Activity**, **Danger zone**
- **Other pages** — Dashboard, Hub (89-template gallery), Services, Databases
  (+ detail, topology, Studio), Projects, Labels, Workspaces, Domains, Tunnels,
  Networks, Volumes, Topology, Backups, Sources, Servers, Users, Monitoring,
  Docker, Traefik, Activity, **Manifest Creator** (15 section editors + secret
  scan), Settings (Account / Appearance / Security / System / Notifications /
  Integrations / Storage / LogDrains / SSO / Firewall / ConfigCenter / Plugins /
  Migration), About

## 12. Alerting

Threshold rules (`alert_rules`) evaluated by the collector on every 30 s sample:

```
ok → breaching (first breach, breach_since = now)
   → firing  (breach sustained ≥ duration_windows × 30s → ONE notification)
   → ok      (clears → recovery notification, only if it had fired)
```

- Metrics: `cpu` (% per container or host), `memory` (MiB), `cert-expiry` (days
  remaining across issued Let's Encrypt certificates)
- Notifications ride the existing channels via `audit()` → `notifyEvent`
  (`alert.fired` / `alert.recovered`, filterable per channel)
- Anti-spam: 30-minute cooldown before re-notifying; state reset on rule edits

## 13. Testing

| Package | Files | Statements / Branches / Functions / Lines |
|---|---|---|
| apps/server | 183 (2 472 tests) | **95 / 90 / 95 / 95** |
| apps/web | 80 (1 358 tests) | **99 / 95 / 99 / 99** |
| apps/cli | 23 (446 tests) | 100 / 100 / 100 / 100 |
| packages/db | 7 (24 tests) | 100 |
| packages/schemas | 4 (257 tests) | 100 |
| packages/sdk | 3 (121 tests) | 100 |
| packages/mcp | 2 (27 tests) | 100 |
| packages/plugin-sdk | 1 (7 tests) | 100 |

The server and web floors were deliberately lowered from 100 with the reasoning
recorded inline in their `vitest.config.ts`. Integration tests (testcontainers,
real PostgreSQL/MySQL/Redis/MongoDB/Valkey/ClickHouse + deploy e2e) are opt-in
via `RUN_INTEGRATION=1` and run as a separate CI job.

CI (`ci.yml`) runs typecheck → lint → build → test, plus a **schema-drift check**
(regenerating migrations must produce no diff) and a **deprecated-dependency
check**, then a Docker image build and the integration job.

⚠ The schema-drift gate is currently **non-functional**: drizzle-kit's snapshot
chain stops at `0031`, so `drizzle-kit generate` diffs against a five-migration-
old schema, hits a column-rename prompt and aborts on the missing TTY — the
failure the step's own comment anticipates. Migrations `0032`–`0038` are
hand-written (the established practice in this repo) and validated by
`test/schema-drift.test.ts`, which applies every migration to a fresh in-memory
database. Restoring the gate means regenerating the missing snapshots.

## 14. Installation, updates and supervision

- **`install.sh`** (1 458 lines): checks/installs Node ≥ 22.13 and Docker via
  signed APT repos, installs a **checksum-verified Nixpacks** binary, resolves
  the target version via release channels (`--channel=release` default,
  `--channel=main`, `--version vX.Y.Z`), supports both **bare-metal** and
  `--docker` (compose) modes, renders the systemd unit from placeholders,
  installs a migration safety override, snapshots `.data` before upgrading,
  rebuilds + migrates + restarts and gates on `/health`. Builds a Traefik
  fallback image when the upstream one is unusable
- **Update check** (`lib/updateCheck.ts`): GitHub-Releases-format feed, semver
  compare, 6 h cache; offline → `updateAvailable: null`
- **Self-update** (`lib/selfUpdate.ts`): `POST /v1/system/update-start` with
  progress polling — one-click panel upgrade from the dashboard
- **systemd**: `Type=simple`, `WatchdogSec=0`, `Restart=always`, hardening
  (`ProtectSystem=full`, explicit `ReadWritePaths`, `NoNewPrivileges`,
  `PrivateTmp`); readiness verified through the HTTP `/health` gate so
  long-running Docker children are not killed by a watchdog

## 15. Security model

- **Containers**: healthchecks probe container network IPs; Traefik routes by
  name over the shared network. Host ports are *not* published by default, but
  `services.published_port` is a real, operator-gated feature — reserved ports
  (panel, 80, 443, 22) are refused for everyone, sub-1024 for non-operators
- **Traefik**: the intended sole public listener; dynamic config written
  atomically with a directory bind mount; Host/Path operands sanitized
- **Secrets**: AES-256-GCM in versioned envelopes (`v<ver>:iv:tag:ct`). Master
  key rotatable via the `NINEDEPLOY_MASTER_KEYS` ring + `rotateSecrets`
  re-encryption job; legacy envelopes stay readable (key version 0)
- **Backups encrypted at rest** — dumps are sealed with the master key on write;
  restore and download decrypt transparently, legacy plaintext restores as-is
- **Webhooks**: HMAC-SHA256 (GitHub/Gitea) or token (GitLab) + branch match +
  watch-path globs + replay dedup; public receiver rate-limited 60/min
- **SSRF egress guard** (`lib/egressGuard.ts`): outbound operator-supplied URLs
  (notification webhooks, OIDC issuer, S3 endpoint, template source, log drains,
  git remotes, insights) are refused when they resolve into private, loopback or
  link-local space — closing the metadata-service (`169.254.169.254`) and
  internal-container reach. DNS rebinding is explicitly *not* solved; escape
  hatch `NINEDEPLOY_ALLOW_PRIVATE_EGRESS=1`
- **Domain ownership proof** (`lib/domainVerification.ts`): non-operators must
  prove control of a hostname before attaching it
- **Subprocess hygiene**: whitelisted env inheritance (never `NINEDEPLOY_*`);
  runtime secrets via temp `--env-file` (0600, deleted after start); tree-killed
  on timeout
- **DB ops**: idempotent container start; backup/restore via arg-array
  `docker exec` + `docker cp` (no host shell); restore ownership-checked
- **Imports**: tar members validated before extraction (tar-slip); system import
  rolls back on mid-flight failure; per-service bundles operator-only
- **Logs**: request serializer strips query strings
- **Production guards**: refuses to boot with a known-insecure JWT secret, or
  with a weak/short master key (checked for both `NINEDEPLOY_MASTER_KEY` and
  every version in `NINEDEPLOY_MASTER_KEYS`)

## 16. Known gaps (implementation vs. intent)

These are load-bearing facts about the current architecture. They are listed
here so the rest of this document can be read as accurate.

### 16.1 ~~Operator privilege is self-granting~~ — FIXED in 0.3.5

`isOperator` used to mean "owner/admin in at least one workspace", and any
authenticated user could create a workspace they own. One request therefore
promoted any member to full instance operator — including the host-privileged
deploy paths, i.e. arbitrary code execution on the host.

Resolved by migration `0038` + `users.is_instance_operator`: the flag is now an
explicit column, granted at bootstrap or by an existing operator
(`PATCH /v1/users/:id/operator`), never by workspace membership. The last
operator cannot be demoted or deleted. See §8.1;
`test/operatorEscalation.test.ts` fails against the old implementation.

Backfill on upgrade is deliberately narrow: the bootstrap user (lowest id) plus
owners/admins of the OLDEST workspace. Anyone who had become an "operator" by
creating their own workspace is **not** carried over — an operator re-grants the
flag from Settings → Users if that was legitimate.

### 16.2 ~~The `.ninedeploy` manifest is ~20 % wired~~ — mostly FIXED in 0.3.5

Only `routes`, `database` and `alerts` reached a deploy; `build`, `run`,
`runtime`, `phases`, `resources` and `env.required` were parsed, validated,
covered by tests and offered in a 15-section Manifest Creator — then dropped.
`lib/ninedeployToNixpacks.ts` (234 LOC) and `lib/ninedeployApply.ts` (63 LOC)
had no importers, while `docs/NINEDEPLOY_MANIFEST.md` §6.1 described a
`nixpacks.toml` that nothing generated.

Now wired, under the documented `panel > manifest > auto-detect` rule:

| Section | Effect |
|---|---|
| `build.install/build/start/baseDir/dockerfile` | folded into the effective `BuildConfig` for this deploy (never persisted — the manifest travels with the commit) |
| `run.port`, `run.healthcheck` | fill `services.port` / `health_path` when unset |
| `run.restart` | fills `build_configs.restart_policy` when still at the default |
| `resources.cpuShares`, `resources.memMb` | fill the limits when the panel left them at 0 (unlimited) |
| `env.required` | each missing key is a deploy-log warning (not fatal — the value may come from the image) |
| `runtime`, `phases` | rendered into a real `nixpacks.toml` next to the source by the Docker builder; a repo that already ships one keeps it |

**`hooks` is deliberately still ignored**, and now says so in the deploy log.
Deploy lifecycle hooks execute on the HOST, which is exactly what
`lib/hostPrivilege.ts` gates behind the instance-operator flag — and that gate
reads the STORED build config before the deploy starts. Honouring a
manifest-supplied hook would let anyone with push access to the repository run
commands on the host, bypassing the boundary and breaking container isolation
for ordinary Docker services. Hooks stay a panel-only setting.

Still unwired (each emits a deploy-log warning): `volume.backups`,
`notifications`, `previews`, `static`, `watch`, `network`.

### 16.3 The microkernel and plugin marketplace are inert

`src/kernel/` (~2 000 LOC), 4 route modules, a Settings page, 6 MCP tools and
`packages/plugin-sdk` implement a plugin system that currently loads no code:

- `createDynamicPlugin()` never `import()`s anything. `source: 'npm' | 'git'`
  only derive an id string; installing a marketplace plugin writes a DB row and
  registers an object whose `init` emits one event
- The three built-in plugins subscribe to `deployment.status_changed`,
  `service.health_changed` and `backup.completed` — **no code emits any of
  them**. The notifications plugin emits `notification.queued`, which **nothing
  consumes**. The telemetry plugin's `export_endpoint` config key is never read
- There are two unrelated event buses: `lib/events.ts` (real — `audit()` →
  `/v1/events` WebSocket) and `kernel/eventBus.ts` (ornamental)

What *is* real: `ConfigCenter` (`config_entries` persistence + secret reveal)
and `MenuRegistry` (`Layout.tsx` does render `/v1/menus` items).

*Fix direction*: pick one. Either make it real (bridge `lib/events` → kernel
bus, have `notification.queued` reach `lib/notifier`, and load plugins through a
vetted dynamic import with a signature/allowlist), or demote it to what it is —
ConfigCenter + MenuRegistry — and delete the marketplace UI, catalog and MCP
tools. Shipping an installable-looking marketplace that installs nothing is the
worse of the two.

### 16.4 ~~The role hierarchy is documented but not enforced~~ — FIXED in 0.3.5

`assertWorkspaceRole` / `roleAtLeast` existed with zero call sites, so a
`viewer` could create services, edit environment variables and trigger deploys
exactly like an `owner`.

`assertServiceRole` (in `resourceAccess.ts`) is now the enforcement point and is
applied across the service, deploy, env, domain and tag routes. Reads need any
seat; writes need `member`; destroy and re-tag need `admin`. See the table in
§8.1 and `test/workspaceRoleEnforcement.test.ts`.

`assertDatabaseRole` extends the same hierarchy to managed databases, whose
workspace comes from their project: reads need any seat, lifecycle and limits
need `member`, and deletion, backups, restores and credential reveal need
`admin`. Service volumes and cron jobs follow the service role.

Two deliberate exceptions stay instance-operator-only regardless of workspace
role, because they reach past the workspace boundary: **database Studio** (binds
a host port) and the **volume-scope backups** at `/backups/:bid` (no owning
database to derive a role from).

Relaxing the credential and backup routes from operator-only also required
adding the per-database ownership check that `DELETE /backups/:bid` and
`GET /backups/:bid/download` never had — while only operators could reach them
an id-based lookup was safe; with workspace admins in scope it is not.

### 16.5 ~~API token scopes are stored but never checked~~ — FIXED in 0.3.5

`api_tokens.scopes` was written as `[]` on every create and read by nothing, so
every token carried its owner's full authority, operator flag included. A CI or
MCP token was an instance-root credential.

Scopes are now a real, enforced vocabulary — `read` (safe methods only),
`write` (mutate, but always as a NON-operator) and `operator` — applied in one
place, `plugins/auth.ts`, so new routes are covered the day they are added. A
token can never outrank its owner: requesting `operator` as a non-operator is
refused at creation. Tokens also accept an optional `expiresInDays`.

An EMPTY scope list still means unrestricted. That is deliberate back-compat for
tokens already deployed in someone's CI; the CLI now prompts for a scope and
`ninedeploy token list` labels the legacy ones `unrestricted`. Auditing and
re-issuing those is an operator task, not something an upgrade should do
silently.

### 16.6 Agent transport is unencrypted

See §9. `http://` only, carrying the agent token and decrypted service secrets.
*Fix direction*: mTLS or at minimum HTTPS with a pinned cert, plus a documented
"agents must be on a private network" constraint until then.

### 16.7 ~~Three different list-scoping implementations~~ — FIXED in 0.3.5

`GET /v1/services` (owner-only), `/dashboard` and `/domains`
(owner ∪ workspace-tagged) and `loadServiceForUser` (…∪ operator) disagreed. The
visible symptom was a teammate seeing an empty services list while the dashboard
counted those same services.

All four now call `visibleServiceIdSet(db, user)` in `resourceAccess.ts`
(`null` = unrestricted, for operators). The inline copies in `dashboard.ts` and
`domainIndex.ts` are gone.

Note the trade-off: `GET /v1/services` now loads the visible rows and filters in
memory rather than pushing the owner match into SQL. That matches what the tag
filter already did, and matters only at a scale a self-hosted panel does not
reach — but see §16.8.

### 16.8 Smaller items

- `GET /v1/services` loads every visible row and filters tags **in memory**;
  same for `visibleDatabaseIds`, which reads the whole `databases` table. Fine
  at self-hosted scale, but it is an O(n) full scan per request
- Migration tag `0020` is skipped (journal-authoritative, cosmetic)
- `lib/auth.ts` still reads a legacy `users.role` column that migration `0034`
  removed; it survives only as a test-fixture back-compat marker
- WAL is off by design (§4) — this serializes writers behind readers under the
  worker + collector + two schedulers. It is the right trade for single-file
  backups, but it caps concurrency and should be revisited together with the
  export path if throughput ever matters

## 17. Key design decisions

- **Single SQLite database** — no PostgreSQL/MongoDB/Redis dependency; libsql
  client on a local file; `foreign_keys = ON`, `busy_timeout = 5000`, WAL off
  for safe single-file backups; hot paths indexed
- **Self-migrating server** — startup applies pending SQL migrations via
  Drizzle's runtime migrator, tolerating pre-journal hand-patched columns;
  drizzle-kit stays a devDependency
- **Core runs bare-metal (systemd) or as a socket-mounted container** — PM2 and
  UFW features require the bare-metal install
- **Docker CLI, not dockerode** — every engine operation is a validated
  arg-array spawn through one choke point, shared by local and agent execution
- **Traefik file provider** — dynamic config regenerated atomically on every
  deploy/domain change; directory-mounted
- **Container-name routing** — Traefik reaches containers by name over the
  shared network; host ports are an explicit, gated exception
- **Blue-green (Docker) + rollback (PM2/Compose)** — two versions run side by
  side; PM2 can't (port conflict) so it auto-rolls back. In-flight deploys can
  be cancelled at every stage checkpoint
- **Typed agent protocol** — remote execution is a fixed operation table with
  regex-validated operands, not arbitrary shell
- **Image digest pinning** — each deployment records the exact digest it ran, so
  rollback redeploys that precise image
- **Deployment history is honest** — a superseded build is marked `superseded`,
  not left `running` forever
- **Fire-and-forget notifications** — `audit()` → DB write + EventBus +
  notifier, never blocks the request
- **Bounded retention** — metrics 24 h, deploy logs 30 d, audit 90 d,
  notification log 30 d, dangling images hourly; scheduled backups keep 7
  (manual untouched), volume backups keep `NINEDEPLOY_BACKUP_VOLUME_RETAIN_COUNT`
- **Forward-only, additive migrations** — no down-SQL; a bad migration leaves an
  unused object rather than losing data
- **Tiered coverage gates** — 100 % where it is achievable (db, schemas, sdk,
  mcp, plugin-sdk, cli), 99 % web, 95 % server, each floor justified in its
  config rather than silently ratcheted
- **TypeScript strict** — `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `isolatedModules`; Node ≥ 22.13
