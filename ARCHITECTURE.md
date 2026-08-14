# NineDeploy — Architecture

A self-hosted, single-server deployment platform. The core server runs bare-metal (systemd) for direct PM2 + Docker daemon access; a container image is also published for Docker-based installs (host socket mounted). All app containers live on a shared Docker network (`ninedeploy`); only Traefik is exposed on :80/:443.

## System diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │              NineDeploy Core (Fastify)           │
                        │              apps/server (systemd)               │
   User ──────── WebUI ─┤                                                │
   (React+Vite)         │  ┌──────────────┐  ┌───────────────────────┐   │
   CLI ─────────────────┤  │ Auth         │  │ Deploy Engine          │   │
   (commander)          │  │ JWT+tokens   │  │  Git clone → Build     │   │
                        │  │ Argon2       │  │  → Run → Healthcheck   │   │
                        │  │ RBAC         │  │  → Domain assignment   │   │
                        │  ├──────────────┤  ├───────────────────────┤   │
                        │  │ Secrets      │  │ Builders               │   │
                        │  │ AES-256-GCM  │  │  ├─ Docker (BuildKit) │   │
                        │  │ key ring     │  │  └─ PM2 (process mgr)  │   │
                        │  ├──────────────┤  ├───────────────────────┤   │
                        │  │ EventBus     │  │ Database Engine         │   │
                        │  │ WebSocket    │  │  PG/MySQL/Redis/Mongo  │   │
                        │  │ push to UI   │  │  + volumes + backup    │   │
                        │  ├──────────────┤  ├───────────────────────┤   │
                        │  │ Notifier     │  │ Plugins                 │   │
                        │  │ Telegram     │  │  ├─ Worker (job queue) │   │
                        │  │ Discord      │  │  ├─ Collector (metrics)│   │
                        │  │ Webhook      │  │  ├─ Traefik (proxy)    │   │
                        │  │              │  │  ├─ Backup scheduler   │   │
                        │  │              │  │  ├─ Housekeeping       │   │
                        │  │              │  │  ├─ Rate limit         │   │
                        │  │              │  │  └─ RawBody (HMAC)     │   │
                        └──┬──────────┬───┴──┴───────────────────────┴───┘
                           │          │
              ┌────────────▼┐  ┌──────▼──────────────┐
              │  Traefik    │  │   SQLite (.data/)    │
              │  :80 / :443 │  │   Drizzle ORM        │
              │  auto-HTTPS │  │   self-migrating     │
              └──────┬──────┘  └─────────────────────┘
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
ninedeploy/
├── apps/
│   ├── server/                    Fastify API + deploy engine
│   │   ├── src/
│   │   │   ├── engine/            pipeline, builders (docker/pm2), database,
│   │   │   │                      proxy (traefik), tunnel, logs
│   │   │   ├── modules/           route handlers (25+ modules incl. settings)
│   │   │   ├── plugins/           fastify plugins (db, auth, worker, traefik,
│   │   │   │                      collector, backup, housekeeping, rateLimit,
│   │   │   │                      rawBody)
│   │   │   ├── lib/               crypto (key ring), jwt, exec (timeout+tree-kill,
│   │   │   │                      env whitelist), git, settings, keyRotation,
│   │   │   │                      audit, events, notifier, errors, webhooks
│   │   │   ├── templates/         49-entry template registry
│   │   │   └── version.ts         VERSION + changelog
│   │   ├── test/                  unit/route tests (100% coverage)
│   │   └── test/integration/      testcontainers (real PostgreSQL), RUN_INTEGRATION=1
│   │
│   ├── web/                       React 19 + Vite 8 + Tailwind v4
│   │   ├── src/routes/            15 pages (Dashboard, Hub, Services, Databases,
│   │   │                          Domains, Tunnels, Volumes, Topology, Backups,
│   │   │                          Sources, Users, Monitoring, Settings, About,
│   │   │                          Login)
│   │   ├── src/components/        Layout, DeployWizard, DatabaseWizard,
│   │   │                          NotificationWizard, CommandPalette,
│   │   │                          ContainerTerminal, Toast, …
│   │   └── src/lib/               api (SDK + 401→refresh→retry), auth (context),
│   │                              theme, useDeployLogs
│   │
│   └── cli/                       `ninedeploy` CLI (commander)
│
├── packages/
│   ├── db/                        Drizzle ORM schema + migrations (SQL shipped;
│   │                              server self-migrates at startup via the
│   │                              runtime migrator — drizzle-kit is dev-only)
│   ├── schemas/                   Zod validation schemas (shared)
│   └── sdk/                       Typed API client (shared by web + cli)
│
├── .github/workflows/             ci.yml (typecheck/lint/build/test/image build),
│                                  release.yml (tag → GHCR image)
├── Dockerfile                     multi-stage; docker CLI + git + tini; /data volume
├── docker-compose.yml             development environment
├── systemd/                       ninedeploy.service unit file
├── install.sh                     One-click installer (Node ≥ 22.13)
└── ARCHITECTURE.md                This file
```

## Database schema (20 tables)

```
users              id, email, password_hash, name, role(admin|member),
                   token_version (JWT revocation counter)
api_tokens         id, user_id, name, hash, scopes, last_used_at, expires_at
projects           id, name, slug, description
services           id, project_id, name, slug, type(pm2|docker), status,
                   repo_url, branch, source_id, image, volume_mount, health_path,
                   commit_sha, runtime_id, cpu_shares, mem_limit_mb, port
build_configs      id, service_id, build_pack, base_dir, install/build/start_cmd, dockerfile_path
deployments        id, service_id, status, commit_sha, image_digest (exact
                   rollback pin), message, author, trigger, log_path,
                   started_at, finished_at
env_vars           id, service_id, key, value_encrypted, is_secret
sources            id, type(github|gitlab|gitea|custom), name, token_encrypted, deploy_key_encrypted
domains            id, service_id, hostname, path, ssl, redirect_www, status
webhooks           id, source_id, service_id, branch, events, secret_encrypted, active
databases          id, project_id, name, slug, engine, version, status, container_name,
                   internal_host, internal_port, username, password_encrypted, db_name,
                   volume_name, cpu_shares, mem_limit_mb
database_attachments  id, service_id, database_id, env_alias
backups            id, database_id, scope(db|scheduled|…), status, path, size_bytes
metrics            id, service_id, kind(cpu|memory), value, ts   [(service,kind,ts) index]
audit_log          id, user_id, action, entity, meta(json), ts   [(entity,ts) index]
settings           key, value(json)   (allow_registration, …)
tunnels            id, name, slug, token_encrypted, status, container_name
notification_channels  id, name, type(telegram|webhook|discord|slack|ntfy|email),
                       target_encrypted, event_filter, active
notification_log       id, channel_id, event, entity, status(sent|failed), attempts,
                       error, ts
alert_rules            id, service_id (null = host-wide), name, metric(cpu|memory|cert-expiry),
                       operator(>|<), threshold, duration_windows, enabled
alert_state            rule_id (unique), status(ok|breaching|firing), breach_since,
                       fired_at, last_notified_at, last_value
```

## Server modules

| Module | Prefix | Routes |
|---|---|---|
| auth | /auth | register (toggle-gated), login, refresh, logout, password, me, status, tokens CRUD |
| services | /services | CRUD, stop/start/restart, limits, logs |
| deploys | /services/:id/deploys | trigger, list, rollback, WS logs, WS exec (admin-only, audited) |
| domains | /services/:id/domains | add, list, remove |
| domainIndex | /domains | list all, SSL toggle |
| databases | /databases | CRUD, limits, wizard |
| databaseBackup | /databases/:id | storage, backups, restore (ownership-checked) |
| backups | /backups | list all, delete, download |
| env | /services/:id/env | env var CRUD |
| hooks | /hooks + /services | receive (HMAC + replay dedup), manage CRUD |
| templates | /templates | list, detail, deploy |
| topology | /topology | graph (services+DBs+domains+attachments) |
| stats | /stats + /services/:id/metrics | live snapshot, time series |
| dashboard | /dashboard | aggregate stats + health probes + recent |
| sources | /sources | CRUD (PAT + deploy keys) — admin-only |
| tunnels | /tunnels | CRUD (cloudflared) — admin-only |
| volumes | /volumes | inventory; delete — admin-only, audited |
| system | /system | resources, prune, export, import (tar-slip guarded, rollback) — admin-only |
| settings | /settings | instance flags: allow-registration toggle, ACME email — admin-only, audited |
| users | /users | list, role change, password reset, delete — admin-only |
| notifications | /notifications | channels CRUD, test, log — admin-only |
| about | /about | version, changelog, tech stack, stats |
| activity | /activity | audit log feed |
| alerts | /alerts | alert rule CRUD + state; members read, admins manage |
| serviceMigration | /services/:id/export + import | per-service bundle — admin-only |
| health | /health | liveness + DB ping |
| events | /v1/events (WS) | real-time event stream |

## Plugins

| Plugin | Function |
|---|---|
| db | Decorates `fastify.db` with Drizzle; enables `PRAGMA foreign_keys`; **applies pending migrations via the runtime migrator** (idempotent startup — no drizzle-kit in production) |
| auth | `authenticate` pre-handler (JWT + API token, role fetched fresh per request) + `requireAdmin` guard |
| rateLimit | Global + per-route IP rate limiting (auth/setup/webhook tighter) |
| worker | Polls queued deployments, claims atomically (rowsAffected-verified), runs the pipeline one at a time, sweeps stale `building` rows on boot |
| traefik | Ensures network + Traefik container (config **directory** bind mount) + writes dynamic config atomically |
| collector | Samples container stats every 30s → metrics table; prunes metrics older than 24h; feeds the alert evaluator (cpu %, memory MiB, host, cert-expiry days) |
| backupScheduler | Daily database backups (`scheduled` scope), keeps last 7 per DB — never prunes manual backups |
| housekeeping | Hourly retention: deploy logs (30d), audit log (90d), notification log (30d), dangling Docker images |
| rawBody | Captures raw body for HMAC + binary uploads |

## Deploy pipeline

Zero-downtime for Docker, brief-gap-with-rollback for PM2. The worker processes one deployment at a time and recovers from crashes on startup.

```
1. Trigger (manual / webhook / CLI) → deployment row (queued)
2. Worker claims it atomically (queued→building, verified via rowsAffected) → status: building
3. Crash recovery on boot: any deployment stranded in `building` is marked failed
4. If image deploy: pull image (rollback pins an exact digest); else: git clone →
   resolve source creds → checkout commit (token/SSH key scrubbed afterwards)
5. Build: Docker (buildx) or PM2 (install + build commands, with the service env
   so builds see DB URLs)
6. Start NEW runtime (docker run / pm2 start) with env-file secrets + network +
   volume + limits — the previous Docker container keeps serving (blue-green)
7. Health check: container alive (docker inspect) AND HTTP probe on the
   container's network IP (fresh per attempt; per-attempt AbortSignal timeout)
8. Success path (isolated, best-effort — never kills the healthy container):
   - mark service running + persist the resolved image digest
   - auto-assign wildcard domain (failure logged, not fatal)
   - flip Traefik routing (atomic write); only then stop the previous container
9. Failure path: stop the NEW runtime; if the previous runtime is still healthy
   (Docker), roll back to it (service stays running, deployment marked failed)
10. Every subprocess has a hard timeout + tree-kill (SIGTERM→SIGKILL), so a hung
    build can never block the worker. Audit + EventBus + notification dispatch
    throughout; logs streamed via WebSocket.
```

## Alerting

Threshold rules (`alert_rules`) evaluated by the collector on every 30s sample:

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

## Security model

- **Containers**: no host ports published at all — healthchecks probe container network IPs; Traefik routes by name over the shared network
- **Traefik**: the only publicly exposed service (:80/:443); dynamic config written atomically (temp+rename) with a directory bind mount (single-file mounts pin the inode and never see renames); Host/Path operands sanitized against rule/YAML injection
- **Backups encrypted at rest** — dumps are sealed with the master key the moment they hit disk (a stolen data dir must not leak the otherwise-encrypted DB credentials); restore and download decrypt transparently, legacy plaintext backups restore as-is
- **Secrets**: AES-256-GCM in **versioned envelopes** (`v<ver>:iv:tag:ct`). Master key rotatable via the `NINEDEPLOY_MASTER_KEYS` ring + `rotateSecrets` re-encryption job; legacy envelopes stay readable (resolved to key version 0)
- **Auth**: JWT access (15 m) + refresh (7 d); API tokens sha256-hashed. Tokens carry a `ver` claim matched against the user's `tokenVersion` — logout, role change, and password change/reset all bump it, revoking every outstanding session (access *and* refresh) statelessly
- **Passwords**: Argon2id; self-service change (requires current password) + admin reset
- **RBAC**: admin-only for exec, volumes, sources, tunnels, notifications, system, settings, users, service bundles; role fetched fresh from the DB on every request
- **Registration gate**: `allow_registration` setting (default on) blocks self-registration; bootstrap (zero users) always permitted
- **Rate limiting**: global + tight auth/setup/webhook ceilings
- **Production guard**: refuses to boot with the insecure default JWT secret
- **Webhooks**: HMAC-SHA256 (GitHub/Gitea) or token (GitLab) + replay dedup (same commit already queued/building/running → skipped)
- **Subprocess hygiene**: whitelisted env inheritance (never `NINEDEPLOY_*`); runtime secrets via temp `--env-file` (0600, deleted after start); tree-killed on timeout
- **DB ops**: idempotent container start; backup/restore via arg-array `docker exec` + `docker cp` (no host shell); restore ownership-checked; `MYSQL_PWD`-style env, never shell-interpolated
- **Imports**: tar members validated before extraction (tar-slip); system import rolls back to the original state on mid-flight failure; per-service bundles admin-only (plaintext secrets)
- **Logs**: request serializer strips query strings (WS `?token=` never persisted)
- **CORS**: allowlist (public URL + dev ports + `NINEDEPLOY_CORS_ORIGINS`)
- **Notifier**: 10s fetch timeouts; HTML-escaped entities

## Key design decisions

- **Single SQLite database** — no PostgreSQL/MongoDB/Redis dependency; `PRAGMA foreign_keys = ON`; hot paths indexed (metrics `(service,kind,ts)`, deployments `(status)`, audit `(entity,ts)`, …)
- **Self-migrating server** — startup applies pending SQL migrations via Drizzle's runtime migrator; drizzle-kit stays a devDependency; containers and bare-metal both boot on a fresh DB
- **Core runs bare-metal** (systemd) — direct PM2 + Docker daemon access; the published image covers Docker installs (socket-mounted, `/data` volume)
- **Traefik file provider** — dynamic config regenerated atomically on every deploy/domain change; directory-mounted into the container
- **Container-name routing** — Traefik reaches containers by name over the shared network; no host ports on apps
- **Blue-green (Docker) + rollback (PM2)** — two versions run side by side (no port contention); PM2 can't (port conflict) so it auto-rolls back on failure
- **Image digest pinning** — each deployment records the exact image digest it ran, so rollback redeploys that precise image
- **Fire-and-forget notifications** — audit() → DB write + EventBus + notifier, never blocks the request
- **Bounded retention** — metrics 24h (collector), deploy logs 30d, audit 90d, notification log 30d, dangling images hourly; scheduled backups keep 7 (manual backups untouched)
- **Forward-only, additive migrations** — drizzle-kit emits no down-SQL; every migration is additive, so a bad one leaves an unused object rather than data loss. To revert: drop the objects it created
- **100% coverage, no ratchets** — every package's test suite enforces 100% statements/branches/functions/lines in CI; integration tests (testcontainers) are opt-in via `RUN_INTEGRATION=1`
- **TypeScript strict** — noUncheckedIndexedAccess, verbatimModuleSyntax, isolatedModules; Node ≥ 22.13 (pnpm 11 requires `node:sqlite`)
