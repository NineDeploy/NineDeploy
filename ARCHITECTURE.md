# NineDeploy — Architecture

A self-hosted deployment platform with optional multi-server support. The core server runs bare-metal (systemd) for direct PM2 + Docker daemon access; a container image is also published for Docker-based installs (host socket mounted). Remote hosts run the same binary in agent mode (`NINEDEPLOY_AGENT=1`) and execute a fixed table of typed, validated operations for the core. All app containers live on a shared Docker network (`ninedeploy`); only Traefik is exposed on :80/:443.

- **Runtime**: Node ≥ 22.13, pnpm 11 workspace, Turborepo (`turbo run build/dev/lint/typecheck/test/clean/db:*`)
- **Language**: TypeScript 7 strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`), Biome for lint/format
- **Testing**: Vitest 4 + `@vitest/coverage-v8`, Testing Library; ~2 100 tests across the monorepo with 100 % coverage thresholds in every package

## System diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │              NineDeploy Core (Fastify)           │
                        │              apps/server (systemd)               │
   User ──────── WebUI ─┤                                                │
   (React+Vite)         │  ┌──────────────┐  ┌───────────────────────┐   │
   CLI ─────────────────┤  │ Auth         │  │ Deploy Engine          │   │
   (commander)          │  │ JWT+tokens   │  │  Git clone → Build     │   │
   MCP ─────────────────┤  │ Argon2+TOTP  │  │  → Run → Healthcheck   │   │
   (stdio)              │  │ RBAC+lockout │  │  → Domain assignment   │   │
                        │  ├──────────────┤  ├───────────────────────┤   │
                        │  │ Secrets      │  │ Builders               │   │
                        │  │ AES-256-GCM  │  │  ├─ Docker (buildx)   │   │
                        │  │ key ring     │  │  ├─ PM2 (process mgr)  │   │
                        │  ├──────────────┤  │  └─ Compose (ndcmp-)   │   │
                        │  │ EventBus     │  ├───────────────────────┤   │
                        │  │ WebSocket    │  │ Database Engine         │   │
                        │  │ push to UI   │  │  PG/MySQL/Redis/Mongo  │   │
                        │  ├──────────────┤  │  + volumes + backup    │   │
                        │  │ Notifier     │  ├───────────────────────┤   │
                        │  │ Telegram     │  │ Plugins                 │   │
                        │  │ Discord      │  │  ├─ Worker (job queue) │   │
                        │  │ Webhook      │  │  ├─ Collector (metrics)│   │
                        │  │              │  │  ├─ Traefik (proxy)    │   │
                        │  │              │  │  ├─ Backup scheduler   │   │
                        │  │              │  │  ├─ Job scheduler      │   │
                        │  │              │  │  ├─ Housekeeping       │   │
                        │  │              │  │  ├─ Rate limit         │   │
                        │  │              │  │  └─ RawBody (HMAC)     │   │
                        └──┬──────┬──┬───┴──┴───────────────────────┴───┘
                           │      │  │
              ┌────────────▼┐  ┌──▼──────────────┐  ┌─────────────────────┐
              │  Traefik    │  │   SQLite (.data/)│  │ Remote agents       │
              │  :80 / :443 │  │   libsql+Drizzle │  │ (NINEDEPLOY_AGENT=1 │
              │  auto-HTTPS │  │   self-migrating │  │  typed ops only)    │
              └──────┬──────┘  └──────────────────┘  └──────────┬──────────┘
                     │
          ┌──────────┼──────────────────────────┐
          ▼          ▼                          ▼
   ┌────────────┐  ┌────────────┐  ┌────────────────────┐
   │ App        │  │ App        │  │ Database           │
   │ containers │  │ containers │  │ containers         │
   │ (PM2 on    │  │ (Docker    │  │ (PG/MySQL/Redis/   │
   │  host)     │  │  image)    │  │  Mongo) + volumes  │
   └────────────┘  └────────────┘  └────────────────────┘
          │          │                          │
          │    ninedeploy Docker network        │
          │    (Traefik resolves containers     │
          │     by name — no host ports)        │
          └──────────┴──────────────────────────┘
```

## Monorepo structure

```
ninedeploy/                       pnpm 11 workspace + Turborepo
├── apps/
│   ├── server/                    Fastify 5 API + deploy engine
│   │   ├── src/
│   │   │   ├── engine/            pipeline, builders (docker/pm2/compose),
│   │   │   │                      database, proxy (traefik), tunnel, logs,
│   │   │   │                      containerFiles, logDrainManager, autoPrune,
│   │   │   │                      serverProvisioner
│   │   │   ├── modules/           route handlers (workspaces, oidc, containers,
│   │   │   │                      logDrains, housekeeping, demo, settings,
│   │   │   │                      projects, servers, jobs, etc.)
│   │   │   ├── plugins/           fastify plugins (db, auth, worker, traefik,
│   │   │   │                      collector, backupScheduler, jobScheduler,
│   │   │   │                      housekeeping, rateLimit, rawBody, kernel)
│   │   │   ├── lib/               crypto (key ring), jwt, totp, loginLockout,
│   │   │   │                      oauth (OIDC/SSO), passwordReset, keyRotation,
│   │   │   │                      agentClient, spawnValidated, sdNotify,
│   │   │   │                      exec, git, settings, audit, events, notifier,
│   │   │   │                      alerting, s3, backupRemote, webhooks, errors
│   │   │   ├── templates/         48-entry template registry (schema-validated
│   │   │   │                      bundle; DB/env source override)
│   │   │   ├── agent.ts           remote-host agent mode (NINEDEPLOY_AGENT=1)
│   │   │   └── version.ts         VERSION + changelog
│   │   ├── test/                  unit/route tests (~1 250 cases, 100% coverage)
│   │   └── test/integration/      testcontainers (real PostgreSQL/MySQL/Redis/
│   │                              MongoDB/Valkey/ClickHouse + deploy e2e)
│   │
│   ├── web/                       React 19.2 + Vite 8 + Tailwind v4.3
│   │   ├── src/routes/            pages (Dashboard, Hub, Services,
│   │   │                          ServiceDetail (Overview/Deploys/Environment/
│   │   │                          Network/Settings/Activity/Architecture/DangerZone),
│   │   │                          Databases (Topology/Backups), Workspaces,
│   │   │                          Domains, Tunnels, Volumes, Topology, Backups,
│   │   │                          Sources, Servers, Users, Monitoring, Settings
│   │   │                          (SsoSection, LogDrainsSection, StorageSection),
│   │   │                          About, Login, ForgotPassword, ResetPassword)
│   │   ├── src/components/        Layout (WorkspaceSwitcher, icon rail + groups),
│   │   │                          DeployWizard, DatabaseWizard, NotificationWizard,
│   │   │                          CommandPalette (Ctrl-K), ContainerTerminal,
│   │   │                          ContainerFileBrowser, VolumeBrowser,
│   │   │                          AttachmentsCard, EnvCard, Sparkline, Toast, ui.tsx
│   │   └── src/lib/               api (SDK + 401→refresh→retry), auth,
│   │                              workspace (WorkspaceProvider context),
│   │                              projects (project-scope context), theme,
│   │                              useDeployLogs (WS)
│   │
│   └── cli/                       `ninedeploy` CLI (commander 15, ws for
│                                  log streaming; token 0600 in
│                                  ~/.ninedeploy/config.json)
│
├── packages/
│   ├── db/                        Drizzle ORM 0.45 schema + migrations on
│   │                              libsql/SQLite (SQL shipped; server
│   │                              self-migrates at startup via the runtime
│   │                              migrator — drizzle-kit is dev-only)
│   ├── schemas/                   Zod v4 validation schemas shared by server,
│   │                              web, CLI, SDK, MCP (common/auth/management/
│   │                              project/service DTOs)
│   ├── sdk/                       Typed API client over a FetchLike abstraction
│   │                              (custom fetch injectable; testable); covers
│   │                              all /v1 endpoints; shared by web + cli + mcp
│   └── mcp/                       MCP server (`ninedeploy-mcp`, stdio) — 15
│                                  tools for AI assistants over the SDK
│
├── website/                       Marketing + docs site (React, Tailwind,
│                                  Radix UI, lucide-react; dark/light)
├── .github/workflows/             ci.yml (typecheck/lint/build/test/image build/
│                                  lockfile guard), release.yml (tag → GHCR image)
├── turbo.json                     Turborepo pipeline (build/test/lint caches)
├── Dockerfile                     multi-stage; docker CLI + git + tini; /data volume
├── docker-compose.yml             development environment
├── systemd/                       ninedeploy.service unit (Type=notify,
│                                  WatchdogSec=90, ProtectSystem=strict)
├── install.sh                     One-click installer (Node ≥ 22.13, release
│                                  channels, pre-update snapshot)
└── ARCHITECTURE.md                This file
```

## Clients

Four first-class clients consume the same REST API (`/v1`) through the shared
typed SDK and Zod schemas:

- **Web** (`apps/web`) — React 19 dashboard; server state via TanStack Query 5,
  no Redux/Zustand (local state is React context only). Realtime is
  purpose-specific: deploy log streaming over `WS /v1/services/:id/deployments/:id/logs`
  (backlog replay + live tail, `useDeployLogs`) and a container exec terminal
  over `WS /v1/services/:id/exec` (xterm.js, binary frames, `?token=` auth).
  Project scoping via a context provider (`lib/projects.tsx`); auth via JWT
  access+refresh in localStorage with a single-flight 401→refresh→retry fetch
  wrapper
- **CLI** (`apps/cli`) — `ninedeploy` (commander 15); token stored 0600 in
  `~/.ninedeploy/config.json`; WebSocket log streaming via `ws`
- **MCP** (`packages/mcp`) — Model Context Protocol server (stdio,
  `@modelcontextprotocol/sdk`) so AI assistants can inspect and operate an
  instance: 12 read-only tools (`list_services`, `get_service`, `service_logs`,
  `list_deploys`, `list_domains`, `list_databases`, `list_projects`,
  `list_alerts`, `activity_log`, `system_stats`, `topology`, `health`) +
  3 guarded actions (`deploy_service`, `restart_service`, `rollback_deploy`),
  authenticated with an API token via
  `NINEDEPLOY_URL` / `NINEDEPLOY_TOKEN`
- **Anything else** — the REST API is stable and Zod-documented; the SDK
  (`createClient({ baseUrl, token, fetch? })`) exposes typed namespaces
  (`auth`, `services`, `deploys`, `domains`, `volumes`, `system`, `tunnels`,
  `activity`, `alerts`, `settings`, `users`, `projects`, `about`,
  `notifications`, `sources`, `webhooks`, `databases`) with a `NineDeployError`
  type and injectable fetch

## Database schema (28 tables, migrations 0000–0019)

Storage: **SQLite** via `@libsql/client` (dialect `turso`, local file
`.data/ninedeploy.db`). PRAGMAs at boot: `foreign_keys=ON`,
`busy_timeout=5000`. WAL is deliberately **off** — backup tarballs copy the
single db file, and a WAL sidecar would make that unsafe (see
`packages/db/src/client.ts`).

```
users              id, email, password_hash, name, role(admin|member),
                   token_version (JWT revocation counter),
                   totp_secret_encrypted, totp_enabled
api_tokens         id, user_id, name, hash(sha256), scopes, last_used_at, expires_at
password_reset_tokens  id, user_id, token_hash (sha256, unique), expires_at, used_at,
                   requested_from — single-use 30-min reset links (raw token
                   never stored; swept after 24 h by housekeeping)
projects           id, name, slug, description
services           id, project_id, name, slug, type(docker|pm2|compose), status,
                   repo_url, branch, source_id, server_id (remote agent),
                   compose_service, image, volume_mount, health_path, cmd,
                   docker_socket, commit_sha, runtime_id, cpu_shares,
                   mem_limit_mb, port
build_configs      id, service_id, build_pack, base_dir, install/build/start_cmd, dockerfile_path,
                   build_context_dir
deployments        id, service_id, status(queued|building|running|failed|cancelled),
                   commit_sha, image_digest (exact rollback pin), message, author,
                   trigger, log_path, started_at, finished_at
env_vars           id, service_id, key, value_encrypted, is_secret
sources            id, type(github|gitlab|gitea|custom), name, token_encrypted,
                   deploy_key_encrypted, registry_username (registry auth)
domains            id, service_id, hostname, path, ssl, redirect_www, status, headers
webhooks           id, source_id, service_id, branch, events, secret_encrypted, active,
                   watch_paths (monorepo path globs)
databases          id, project_id, name, slug, engine, version, status, container_name,
                   internal_host, internal_port, username, password_encrypted, db_name,
                   volume_name, cpu_shares, mem_limit_mb
database_attachments  id, service_id, database_id, env_alias (connection-string injection)
backups            id, database_id, scope(db|scheduled), status, path, size_bytes, remote_key
backup_destinations  id, name, endpoint, region, bucket, prefix, access_key_id,
                   secret_key_encrypted, active — S3-compatible off-site targets
                   (AWS/MinIO/R2/B2)
metrics            id, service_id, kind(cpu|memory), value, ts   [(service,kind,ts) index]
audit_log          id, user_id, action, entity, meta(json), ts   [(entity,ts) index]
settings           key, value(json)   (allow_registration, ACME, …)
tunnels            id, name, slug, token_encrypted, status, container_name
notification_channels  id, name, type(telegram|webhook|discord|slack|ntfy|email),
                       target_encrypted, event_filter, active
notification_log       id, channel_id, event, entity, status(sent|failed), attempts,
                       error, ts
alert_rules            id, service_id (null = host-wide), name, metric(cpu|memory|cert-expiry),
                       operator(>|<), threshold, duration_windows, enabled
alert_state            rule_id (unique), status(ok|breaching|firing), breach_since,
                       fired_at, last_notified_at, last_value
scheduled_jobs        id, service_id, name, cron (5-field), kind(deploy|exec), command,
                       enabled, last_run_at — croner-scheduled (5-min reload)
job_runs              id, job_id, status(running|completed|failed), output, exit_code,
                       started_at, finished_at — run history with captured output
servers               id, name, host, port, status(offline|online|error),
                       token_encrypted, last_seen_at — agent host registry
```

Migration history (`packages/db/src/migrations/`, drizzle-kit generated,
forward-only/additive): 0000 initial 15 tables → 0001 databases + attachments →
0002 cpu/mem limits → 0003 `services.source_id` + deploy keys → 0004 backup↔db
link → 0005 image/volume_mount → 0006 tunnels → 0007 health_path → 0008
notification channels + log → 0009/0010 index rebuilds → 0011
`users.token_version` → 0012 `deployments.image_digest` → 0013 alert rules +
state → 0014 notification retry attempts → 0015 services `cmd`/`docker_socket`
→ 0016 password reset tokens → 0017 big parity batch (backup_destinations,
scheduled_jobs, job_runs, servers, watch_paths, TOTP columns, remote_key,
domain headers, registry username) → 0018 index cleanup.

## Server

### Request lifecycle

`server.ts` → `buildApp()` (`app.ts`): listen, systemd sd_notify
(`notifyReady()` + watchdog ping every 30 s, no-op without `NOTIFY_SOCKET`),
graceful SIGINT/SIGTERM. Plugin registration order in `app.ts`: `rateLimit` →
`rawBody` → `db` → `auth` → route modules → background plugins (`worker`,
`traefik`, `collector`, `backupScheduler`, `housekeeping`, `jobScheduler`) →
`staticFiles` (SPA, last). Body limit 256 MB (system import tarballs). CORS
allowlist (`publicUrl`, dev ports, `NINEDEPLOY_CORS_ORIGINS`). Zod failures map
to `400 validation_error` envelopes.

### Route modules

| Module | Prefix | Routes |
|---|---|---|
| auth | /auth | first-admin setup, login (lockout + TOTP 2FA), passkey register/login ceremonies, session list/revoke, forgot/reset-password, 2FA setup/enable/disable, refresh (jti-enforced), logout, password, me, status, tokens CRUD |
| projects | /projects | project CRUD — services/databases/domains are scoped to a project (single level, optional) |
| services | /services | CRUD (docker/pm2/compose types), update (incl. build config PATCH), stop/start/restart, limits, logs, export/import |
| deploys | /services/:id/deploys | trigger, list, rollback, **cancel**, **config diff vs previous deploy**, WS logs, WS exec (admin-only, audited) |
| domains | /services/:id/domains | add (with **Cloudflare record auto-provision**), list, remove (record cleanup), per-domain SSL/headers |
| domainIndex | /domains | list all, SSL toggle |
| databases | /databases | CRUD, limits, wizard |
| databaseBackup | /databases/:id | storage, backups, restore (ownership-checked) |
| backups | /backups | list all, delete (incl. remote object), download; /backup-destinations: S3-compatible CRUD + connectivity test (admin) |
| env | /services/:id/env + /projects/:id/env + /env/search | service env CRUD, project-scope shared env CRUD, cross-scope key search |
| hooks | /hooks + /services | receive (HMAC + branch match + **watch-path globs** + replay dedup), manage CRUD; public, rate-limited 60/min |
| templates | /templates | list, detail, deploy — served from a schema-validated registry bundle (bundled JSON by default; DB/env source override with 6 h cached remote fetch + offline fallback) |
| topology | /topology | graph (services+DBs+domains+attachments) |
| stats | /stats + /services/:id/metrics | live snapshot (cached on `app.stats`), time series |
| dashboard | /dashboard | aggregate stats + health probes + recent |
| sources | /sources | CRUD (PAT + deploy keys + registry creds) — admin-only |
| tunnels | /tunnels | CRUD (cloudflared) — admin-only |
| volumes | /volumes | inventory; delete — admin-only, audited |
| networks | /networks | list (with members), create/delete, container attach/detach (local + typed-agent remote) — admin for writes, audited |
| system | /system | resources, **docker-events feed**, prune, update-check (GitHub-release feed, semver compare, 6 h cache, offline → `updateAvailable: null`), export, import (tar-slip guarded, rollback) — admin-only |
| jobs | /services/:id/jobs | cron-scheduled deploy/exec jobs, run-now, run history (croner; 5-min scheduler reload) |
| servers | /servers | remote agent host registry, one-time token on register, connectivity test — admin-only |
| settings | /settings | instance flags: allow-registration toggle, ACME email, template registry source, DNS-01 challenge (wildcard SSL), **vault provider (Infisical/Doppler) + test**, **Cloudflare DNS records + test** — admin-only, audited |
| users | /users | list, role change, password reset, one-time reset link, delete — admin-only |
| notifications | /notifications | channels CRUD, test, delivery log — admin-only |
| about | /about | version, changelog, tech stack (public); instance counts only for authenticated requests |
| activity | /activity | audit log feed |
| alerts | /alerts | alert rule CRUD + state; members read, admins manage |
| serviceMigration | /services/:id/export + import | per-service bundle, server-to-server moves — admin-only |
| health | /health | liveness + DB ping (public) |
| events | /v1/events (WS) | global real-time event stream (backlog replay, `?token=` auth) |

### Auth, RBAC, and account security

- **JWT** (jose, HS256): access 15 m + refresh 7 d; `ver` claim matched against
  `users.token_version` — logout, role change, and password change/reset all
  bump it, revoking every outstanding session statelessly. The role is
  re-fetched from the DB on every request.
- **Sessions** (`sessions` table, migration 0019): every refresh token carries
  a `jti` referencing a live row (ip, user agent, last used, expiry, revoked).
  `/auth/refresh` enforces the row on every rotation, so a single device can be
  signed out from Settings → Account without touching other sessions. Access
  tokens are short-lived and not per-session-checked (revocation completes
  within the access TTL).
- **Passkeys** (`webauthn_credentials` table, `lib/webauthn.ts`): WebAuthn
  registration + passwordless login via `@simplewebauthn/server`; the relying
  party derives from the public URL hostname, challenges are single-use with a
  5-minute in-memory TTL, signature counters track clone detection.
- **API tokens**: opaque, sha256-hashed at rest, expiry + `last_used_at`.
- **2FA**: dependency-free RFC 6238 TOTP (`lib/totp.ts`), secret encrypted at
  rest; login accepts `totpCode`.
- **Passwords**: Argon2id (`@node-rs/argon2`); self-service change (requires
  current password) + admin reset + single-use reset links.
- **Lockout**: in-memory per-account — 5 consecutive failures → 15 min lock
  (`lib/loginLockout.ts`), on top of per-IP rate limits.
- **RBAC**: two roles (`admin`, `member`); `requireAdmin` gates exec, volumes,
  sources, tunnels, notifications, system, settings, users, service bundles.
- **Registration gate**: `allow_registration` setting (default on); bootstrap
  (zero users) always permitted.
- **WebSocket auth**: `?token=` (query stripped from request logs).

### Plugins

| Plugin | Function |
|---|---|
| db | Decorates `fastify.db` with Drizzle; enables `PRAGMA foreign_keys`; **applies pending migrations via the runtime migrator** (idempotent startup — no drizzle-kit in production) |
| auth | `authenticate` pre-handler (JWT + API token, role fetched fresh per request) + `requireAdmin` guard |
| rateLimit | Global + per-route IP rate limiting (auth/setup/webhook tighter) |
| worker | Polls queued deployments (2 s interval) and runs the pipeline with N parallel slots (`NINEDEPLOY_DEPLOY_CONCURRENCY`, default 1, max 8). Claims are atomic (queued→building UPDATE verified via rowsAffected) and skip services that already have a `building` deployment — so slots can deploy different services simultaneously but never double-run or race one service. Sweeps stale `building` rows to `failed` on boot; 60 s stop grace |
| traefik | Ensures `ninedeploy` network + Traefik v3.3 container (`ninedeploy-traefik`, config **directory** bind mount) + writes dynamic config atomically; ACME uses DNS-01 (wildcard certs) when a DNS provider+token are configured, else HTTP-01 |
| collector | Samples container + host stats every 30 s (`lib/stats.ts`) → metrics table; prunes metrics older than 24 h; feeds the alert evaluator (cpu %, memory MiB, host, cert-expiry days) |
| backupScheduler | Daily database backups (`scheduled` scope), keeps last 7 per DB — never prunes manual backups; pushes to S3-compatible destinations via the dependency-free SigV4 client (`lib/s3.ts`) |
| jobScheduler | Cron-scheduled per-service jobs via croner (deploy/exec kinds); re-reads the jobs table every 5 min so edits apply without a restart; run history captured in `job_runs` |
| housekeeping | Hourly retention: deploy logs (30 d), audit log (90 d), notification log (30 d), expired reset tokens (24 h), dangling Docker images |
| rawBody | Captures raw body for HMAC + binary uploads |

## Deploy engine

Everything goes through the **Docker CLI** via validated spawn — no dockerode.
All process spawning funnels through `lib/spawnValidated.ts` (operand regexes,
arg-array exec, never a shell string); `lib/exec.ts` adds hard timeouts +
tree-kill (SIGTERM→SIGKILL) and a whitelisted env inheritance (never
`NINEDEPLOY_*`).

### Pipeline (`engine/pipeline.ts`)

```
1. Trigger (manual / webhook / CLI / cron job / template) → deployment row (queued);
   a [skip ci]/[skip cd] head-commit marker skips webhook auto-deploys
2. A worker slot claims it atomically (queued→building, verified via
   rowsAffected; claims skip services that already have a building deployment);
   concurrency is partitioned per target server (local + each remote), so each
   partition independently gets NINEDEPLOY_DEPLOY_CONCURRENCY slots → status: building.
   The building row stores a config snapshot (build config + env-key
   fingerprint — values never) powering the per-deploy config diff.
3. Crash recovery on boot: any deployment stranded in `building` is marked failed
4. If image deploy: pull image (rollback pins an exact digest); else: git clone →
   resolve source creds → checkout commit (token/SSH key scrubbed afterwards)
5. Gather env: project-scope shared vars ← service vars ← attached-DB connection
   strings (later wins), then resolve ${{infisical:KEY}}/${{doppler:KEY}}
   vault references at deploy time (fetched from the provider, never stored; a
   missing key fails the deploy rather than leaking the raw reference into a
   container); registry auth from registry-type sources
6. Build via builder dispatch: Docker (buildx) / PM2 (install + build commands,
   with the service env so builds see DB URLs) / Compose (`docker compose up -d
   --build`, project prefix ndcmp-, no blue-green)
7. Start NEW runtime (docker run / pm2 start) with env-file secrets (0600 temp
   file, deleted after start) + network + volume + limits — the previous Docker
   container keeps serving (blue-green)
8. Health check: container alive (docker inspect) AND HTTP probe on the
   container's network IP (fresh per attempt; per-attempt AbortSignal timeout)
9. Success path (isolated, best-effort — never kills the healthy container):
   - mark service running + persist the resolved image digest
   - auto-assign wildcard domain (failure logged, not fatal)
   - flip Traefik routing (atomic write); only then stop the previous container
10. Failure path: stop the NEW runtime; if the previous runtime is still healthy
    (Docker), roll back to it (service stays running, deployment marked failed)
11. Cancel: in-flight deploys can be cancelled — the pipeline re-reads the row
    status between steps and tears down the partial runtime (DeploymentCancelled)
12. Remote services (serverId set): the same pipeline runs against the agent —
    the BuildContext carries the resolved server and the builder executes typed
    ops over lib/agentClient.ts
13. Every subprocess has a hard timeout + tree-kill, so a hung build can never
    block the worker. Audit + EventBus + notification dispatch throughout;
    logs streamed via WebSocket and persisted to disk (engine/logs.ts LogBus)
```

### Builders

- **docker.ts** — build + run on the shared `ninedeploy` network, secrets via
  0600 temp env-file, healthchecks against container IPs (no published ports),
  blue-green switch + automatic rollback
- **pm2.ts** — Node runtime managed by PM2 on the host, stop-then-start
  (brief gap, auto-rollback on failure)
- **compose.ts** — `docker compose up -d --build` with the `ndcmp-` project
  prefix; no blue-green (compose controls the lifecycle)

### Reverse proxy (`engine/proxy.ts`)

Traefik v3.3 as the only exposed container (:80/:443), shared `ninedeploy`
network, atomic dynamic-config writes (temp+rename, directory bind mount),
strict sanitizing of Host/Path rule operands (anti rule/YAML injection), ACME
email + DNS-01 wildcard support from settings.

## Multi-server (agent mode)

Remote hosts run the same server binary with `NINEDEPLOY_AGENT=1`, which boots
a minimal HTTP agent instead of the full API (`src/agent.ts`):

- Registered in the `servers` table via a one-time token (printed once at
  registration); `last_seen_at` tracks health, connectivity testable from the
  Servers page; the shared token is stored encrypted and compared as sha256
  (timing-safe)
- The core talks to agents through `lib/agentClient.ts` → `POST /agent/exec`
  with a **typed operation name** (docker pull/build/run, compose up/down, git
  clone/checkout, env-file write), never a program name or raw argv
- Every operand (names, paths, URLs) is validated by strict regexes on both
  ends; all process spawning funnels through `lib/spawnValidated.ts`
- Deploys targeting a remote service set `serverId`; the pipeline resolves it
  into the `BuildContext` and the chosen builder executes against the agent
- `serviceMigration.ts` moves services between servers (export bundle →
  import on target)

## Projects

A single-level, optional grouping: `projects` scope services, databases, and
domains. The web UI keeps the active project in a context provider
(`lib/projects.tsx`, localStorage-persisted, `null` = all) and filters list
views — deliberately solving the nested-project friction seen elsewhere (the
"Dokploy #2805 problem"). The API accepts project filters on the relevant list
endpoints and exposes `/projects` CRUD.

## Web UI

- **Stack**: React 19.2 + react-router 8 (declarative routes), Vite 8,
  Tailwind CSS v4.3 (CSS-first `@theme` config, no tailwind.config),
  TanStack Query 5, xterm.js 6, @xyflow/react 12 (Topology), lucide-react icons
- **Theming**: dark/light via `data-theme` + **6 accent colors** via
  `data-accent` (`lib/theme.tsx`); Tailwind `@theme` maps indigo-* utilities to
  `--nd-accent*` CSS variables; persisted in localStorage; dark + indigo default
- **Layout**: icon rail with 4 collapsible groups (Deploy / Data / Network /
  System) + secondary panel; Ctrl-K CommandPalette with fuzzy nav + jump to
  services/databases/templates
- **Service Detail** (`routes/service/index.tsx`) — the operational hub, tabs:
  - **Overview** — status header with deploy/restart/stop/start/exec actions,
    live CPU & memory sparklines (`GET /services/:id/metrics`), runtime
    metadata (image digest, commit, port, health path, resource limits),
    enriched deployment history (commit message, trigger, duration) with
    rollback, WebSocket live deploy logs, runtime log tail, exec terminal
  - **Deploys** — deployment list with live WS log streaming, rollback,
    cancel of in-flight deploys
  - **Environment** — env vars (write-only secrets), database attachments
    (connection-string injection), auto-deploy webhooks with one-time secret
    reveal, and **cron jobs** (5-field cron editor, `deploy`/`exec` kinds,
    run-now, run history)
  - **Network** — domain management with per-domain SSL toggle; the
    auto-assigned wildcard domain linked from the header
  - **Settings** — edit service fields (name, branch, repo, source, port,
    health path, volume mount, image) via `PATCH /services/:id`, edit the build
    config (build pack, install/build/start commands, Dockerfile path, base
    dir; build pack `auto` uses the repo's Dockerfile when present, otherwise
    Nixpacks — so Dockerfile-less repos like a plain Next.js app build
    unchanged), and set CPU/memory limits (`PATCH /services/:id/limits`)
  - **Activity** — per-service filtered audit trail (`GET /activity`)
  - **Danger zone** — typed-name delete confirmation, with the service's data
    volume surfaced from the volume inventory
- **Other pages** — Hub (48-entry template gallery), Databases (wizard:
  managed Postgres/MySQL/Redis/Mongo), Domains, Tunnels (Cloudflare), Users,
  Volumes (StorageGauge), Topology (xyflow service graph), Backups (DB
  snapshots + S3 destinations), Sources (private repo credentials), Servers
  (agent hosts; registration prints a one-time token + host command),
  Monitoring (alert rules + dashboards), Settings (Account / Appearance /
  Security / System / Notifications / Migration), About

## Alerting

Threshold rules (`alert_rules`) evaluated by the collector on every 30 s sample:

```
ok → breaching (first breach, breach_since = now)
   → firing  (breach sustained ≥ duration_windows × 30s → ONE notification)
   → ok      (clears → recovery notification, only if it had fired)
```

- Metrics: `cpu` (% per container or host), `memory` (MiB), `cert-expiry` (days
  remaining across all issued Let's Encrypt certificates)
- Notifications ride the existing channels via `audit()` → `notifyEvent`
  (`alert.fired` / `alert.recovered` actions, filterable per channel)
- Anti-spam: 30-minute cooldown before re-notifying a firing alert; state reset
  on rule edits

## Installation, updates, and supervision

- **`install.sh`** (one-click): checks/installs Node ≥ 22.13 (NodeSource/brew),
  clones the repo, resolves the target version via **release channels** —
  `--channel=release` (latest `vX.Y.Z` tag via `git ls-remote`, default),
  `--channel=main` (edge), `--version vX.Y.Z` (pin); renders
  `systemd/ninedeploy.service` from placeholders, enables the service,
  snapshots `.data` before upgrading, rebuilds + migrates + restarts and gates
  on `/health`
- **Update check** (`lib/updateCheck.ts`): GitHub-Releases-format feed, semver
  compare, 6 h cache; offline → `updateAvailable: null` (never breaks the
  dashboard); surfaced to admins via `GET /v1/system/update-check`
- **systemd watchdog**: `Type=notify`, `WatchdogSec=90`, `Restart=always`,
  hardening (`ProtectSystem=strict`, `ReadWritePaths=@DATA_DIR@`,
  `NoNewPrivileges`, `PrivateTmp`); the server pings every 30 s over the
  sd_notify datagram socket so a hung event loop is restarted automatically

## Security model

- **Containers**: no host ports published at all — healthchecks probe container network IPs; Traefik routes by name over the shared network
- **Traefik**: the only publicly exposed service (:80/:443); dynamic config written atomically (temp+rename) with a directory bind mount (single-file mounts pin the inode and never see renames); Host/Path operands sanitized against rule/YAML injection
- **Backups encrypted at rest** — dumps are sealed with the master key the moment they hit disk (a stolen data dir must not leak the otherwise-encrypted DB credentials); restore and download decrypt transparently, legacy plaintext backups restore as-is
- **Secrets**: AES-256-GCM in **versioned envelopes** (`v<ver>:iv:tag:ct`). Master key rotatable via the `NINEDEPLOY_MASTER_KEYS` ring + `rotateSecrets` re-encryption job (`lib/keyRotation.ts`); legacy envelopes stay readable (resolved to key version 0)
- **Webhooks**: HMAC-SHA256 (GitHub/Gitea) or token (GitLab) + branch match + watch-path globs + replay dedup (same commit already queued/building/running → skipped); public receiver rate-limited 60/min
- **Subprocess hygiene**: whitelisted env inheritance (never `NINEDEPLOY_*`); runtime secrets via temp `--env-file` (0600, deleted after start); tree-killed on timeout
- **DB ops**: idempotent container start; backup/restore via arg-array `docker exec` + `docker cp` (no host shell); restore ownership-checked; `MYSQL_PWD`-style env, never shell-interpolated
- **Imports**: tar members validated before extraction (tar-slip); system import rolls back to the original state on mid-flight failure; per-service bundles admin-only (plaintext secrets)
- **Logs**: request serializer strips query strings (WS `?token=` never persisted)
- **CORS**: allowlist (public URL + dev ports + `NINEDEPLOY_CORS_ORIGINS`)
- **Notifier**: 10 s fetch timeouts; HTML-escaped entities
- **Production guard**: refuses to boot with the insecure default JWT secret

## Key design decisions

- **Single SQLite database** — no PostgreSQL/MongoDB/Redis dependency; libsql client (dialect turso) on a local file; `PRAGMA foreign_keys = ON`, `busy_timeout=5000`, WAL off for safe single-file backups; hot paths indexed (metrics `(service,kind,ts)`, deployments `(status)`, audit `(entity,ts)`, …)
- **Self-migrating server** — startup applies pending SQL migrations via Drizzle's runtime migrator; drizzle-kit stays a devDependency; containers and bare-metal both boot on a fresh DB
- **Core runs bare-metal** (systemd) — direct PM2 + Docker daemon access; the published image covers Docker installs (socket-mounted, `/data` volume)
- **Docker CLI, not dockerode** — every engine operation is a validated arg-array spawn through one choke point (`spawnValidated`), shared by local and agent execution
- **Traefik file provider** — dynamic config regenerated atomically on every deploy/domain change; directory-mounted into the container
- **Container-name routing** — Traefik reaches containers by name over the shared network; no host ports on apps
- **Blue-green (Docker) + rollback (PM2/Compose)** — two versions run side by side (no port contention); PM2 can't (port conflict) so it auto-rolls back on failure. In-flight deploys can be **cancelled** — the pipeline checks cancel flags at each stage and tears down the partial runtime
- **Typed agent protocol** — remote execution is a fixed table of operations with regex-validated operands, not arbitrary shell; the same validation guards local spawning
- **Image digest pinning** — each deployment records the exact image digest it ran, so rollback redeploys that precise image
- **Fire-and-forget notifications** — audit() → DB write + EventBus + notifier, never blocks the request
- **Bounded retention** — metrics 24 h (collector), deploy logs 30 d, audit 90 d, notification log 30 d, dangling images hourly; scheduled backups keep 7 (manual backups untouched)
- **Forward-only, additive migrations** — drizzle-kit emits no down-SQL; every migration is additive, so a bad one leaves an unused object rather than data loss. To revert: drop the objects it created
- **100% coverage, no ratchets** — every package's test suite enforces 100% statements/branches/functions/lines in CI (152 test files, ~2 100 tests across the monorepo); integration tests (testcontainers) are opt-in via `RUN_INTEGRATION=1`
- **TypeScript strict** — noUncheckedIndexedAccess, verbatimModuleSyntax, isolatedModules; Node ≥ 22.13 (pnpm 11 requires `node:sqlite`)
