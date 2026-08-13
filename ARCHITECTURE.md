# NineDeploy — Architecture

A self-hosted, single-server deployment platform. The core server runs bare-metal (systemd) for direct PM2 + Docker daemon access. All containers join a shared Docker network (`ninedeploy`); only Traefik is exposed on :80/:443.

## System diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │              NineDeploy Core (Fastify)           │
                        │              apps/server (systemd)               │
   User ──────── WebUI ─┤                                                │
   (React+Vite)         │  ┌──────────────┐  ┌───────────────────────┐   │
   CLI ─────────────────┤  │ Auth         │  │ Deploy Engine          │   │
                        │  │ JWT+tokens   │  │  Git clone → Build     │   │
                        │  │ Argon2       │  │  → Run → Healthcheck   │   │
                        │  │              │  │  → Domain assignment   │   │
                        │  ├──────────────┤  ├───────────────────────┤   │
                        │  │ Secrets      │  │ Builders               │   │
                        │  │ AES-256-GCM  │  │  ├─ Docker (BuildKit) │   │
                        │  │              │  │  └─ PM2 (process mgr)  │   │
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
                        │  │              │  │  └─ RawBody (HMAC)     │   │
                        └──┬──────────┬───┴──┴───────────────────────┴───┘
                           │          │
              ┌────────────▼┐  ┌──────▼──────────────┐
              │  Traefik    │  │   SQLite (.data/)    │
              │  :80 / :443 │  │   Drizzle ORM        │
              │  auto-HTTPS │  │   18 tables          │
              └──────┬──────┘  └─────────────────────┘
                     │
          ┌──────────┼──────────────────────────┐
          ▼          ▼                          ▼
   ┌────────────┐  ┌────────────┐  ┌────────────────────┐
   │ App        │  │ App        │  │ Database           │
   │ containers │  │ containers │  │ containers         │
   │ (PM2/      │  │ (Docker    │  │ PG/MySQL/Redis/   │
   │  Docker)   │  │  image)    │  │ Mongo              │
   │ 127.0.0.1  │  │ 127.0.0.1  │  │ + persistent vol   │
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
│   │   │   ├── engine/            pipeline, builders, database, proxy, tunnel, logs
│   │   │   ├── modules/           route handlers (20+ modules)
│   │   │   ├── plugins/           fastify plugins (db, auth, worker, traefik, collector, backup, rawBody)
│   │   │   ├── lib/               crypto, git, exec, jwt, slug, errors, audit, events, notifier, stats
│   │   │   ├── templates/         49-entry template registry
│   │   │   └── version.ts         VERSION + changelog
│   │   └── dist/
│   │
│   ├── web/                       React 19 + Vite 8 + Tailwind v4
│   │   ├── src/
│   │   │   ├── routes/            15 pages (Dashboard, Hub, Services, Databases, Domains,
│   │   │   │                      Tunnels, Volumes, Topology, Backups, Sources, Users,
│   │   │   │                      Monitoring, Settings, About, Login)
│   │   │   ├── components/        Layout (two-level menu), DeployWizard, DatabaseWizard,
│   │   │   │                      NotificationWizard, CommandPalette, ContainerTerminal,
│   │   │   │                      Toast, EnvCard, AttachmentsCard, Sparkline, StorageGauge
│   │   │   └── lib/               api (SDK), auth, theme, useDeployLogs
│   │
│   └── cli/                       `ninedeploy` CLI (commander)
│
├── packages/
│   ├── db/                        Drizzle ORM schema + 8 migrations (18 tables)
│   ├── schemas/                   Zod validation schemas
│   └── sdk/                       Typed API client (shared by web + cli)
│
├── systemd/                       ninedeploy.service unit file
├── install.sh                     One-click installer
└── ARCHITECTURE.md                This file
```

## Database schema (18 tables)

```
users              id, email, password_hash, name, role(admin|member)
api_tokens         id, user_id, name, hash, scopes, last_used_at, expires_at
projects           id, name, slug, description
services           id, project_id, name, slug, type(pm2|docker), status,
                   repo_url, branch, source_id, image, volume_mount, health_path,
                   commit_sha, runtime_id, cpu_shares, mem_limit_mb, port
build_configs      id, service_id, build_pack, base_dir, install/build/start_cmd, dockerfile_path
deployments        id, service_id, status, commit_sha, message, author, trigger,
                   log_path, started_at, finished_at
env_vars           id, service_id, key, value_encrypted, is_secret
sources            id, type(github|gitlab|gitea|custom), name, token_encrypted, deploy_key_encrypted
domains            id, service_id, hostname, path, ssl, redirect_www, status
webhooks           id, source_id, service_id, branch, events, secret_encrypted, active
databases          id, project_id, name, slug, engine, version, status, container_name,
                   internal_host, internal_port, username, password_encrypted, db_name,
                   volume_name, cpu_shares, mem_limit_mb
database_attachments  id, service_id, database_id, env_alias
backups            id, database_id, scope, status, path, size_bytes
metrics            id, service_id, kind(cpu|memory), value, ts
audit_log          id, user_id, action, entity, meta(json), ts
settings           key, value(json)
tunnels            id, name, slug, token_encrypted, status, container_name
notification_channels  id, name, type(telegram|webhook|discord), target_encrypted,
                       event_filter, active
notification_log       id, channel_id, event, entity, status(sent|failed), error, ts
```

## Server modules (20+)

| Module | Prefix | Routes |
|---|---|---|
| auth | /auth | register, login, refresh, me, status, tokens CRUD |
| services | /services | CRUD, stop/start/restart, limits, logs |
| deploys | /services/:id/deploys | trigger, list, rollback, WS logs, WS exec |
| domains | /services/:id/domains | add, list, remove |
| domainIndex | /domains | list all, SSL toggle |
| databases | /databases | CRUD, limits, wizard |
| databaseBackup | /databases/:id | storage, backups, restore |
| backups | /backups | list all, delete, download |
| env | /services/:id/env | env var CRUD |
| hooks | /hooks + /services | receive (WS), manage CRUD |
| templates | /templates | list, detail, deploy |
| topology | /topology | graph (services+DBs+domains+attachments) |
| stats | /stats + /services/:id/metrics | live snapshot, time series |
| dashboard | /dashboard | aggregate stats + health probes + recent |
| sources | /sources | CRUD (PAT + deploy keys) |
| tunnels | /tunnels | CRUD (cloudflared) |
| volumes | /volumes | inventory, delete |
| system | /system | resources, prune, export, import |
| users | /users | list, role change, delete |
| notifications | /notifications | channels CRUD, test, log |
| about | /about | version, changelog, tech stack, stats |
| activity | /activity | audit log feed |
| serviceMigration | /services/:id/export + import | per-service bundle |
| health | /health | liveness + DB ping |
| events | /v1/events (WS) | real-time event stream |

## Plugins

| Plugin | Function |
|---|---|
| db | Decorates `fastify.db` with Drizzle connection (enables `PRAGMA foreign_keys`) |
| auth | `authenticate` pre-handler (JWT + API token) + `requireAdmin` guard; role fetched fresh per request |
| rateLimit | Global + per-route IP rate limiting (auth/setup/webhook tighter) |
| worker | Polls queued deployments, claims atomically, runs pipeline (one at a time), sweeps stale `building` rows on boot |
| traefik | Ensures network + Traefik container + writes dynamic config (atomically) |
| collector | Samples container stats every 30s → metrics table; prunes metrics older than 24h |
| backupScheduler | Daily database backups, keeps last 7 per DB |
| housekeeping | Hourly retention: prunes deploy logs (30d), audit log (90d), notification log (30d) |
| rawBody | Captures raw body for HMAC + binary uploads |

## Deploy pipeline

Zero-downtime for Docker, brief-gap-with-rollback for PM2. The worker processes one deployment at a time and recovers from crashes on startup.

```
1. Trigger (manual / webhook / CLI) → deployment row (queued)
2. Worker claims it atomically (queued→building, verified via rowsAffected) → status: building
3. Crash recovery on boot: any deployment stranded in `building` is marked failed
4. If image deploy: pull image (rollback pins an exact digest); else: git clone → resolve source creds → checkout commit (token/SSH key scrubbed afterwards)
5. Build: Docker (buildx) or PM2 (install + build commands, with the service env so builds see DB URLs)
6. Start NEW runtime (Docker run or PM2 start) with env-file secrets + network + volume + limits
   — the previous Docker container keeps serving until the new one is healthy (blue-green)
7. Health check: container must be alive (docker inspect) AND probe 127.0.0.1:port/healthPath
   (per-attempt AbortSignal timeout, configurable deadline)
8. Success path (isolated, best-effort — never kills the healthy container):
   - mark service running + persist the resolved image digest
   - auto-assign wildcard domain (failure here is logged, not fatal)
   - flip Traefik routing to the new container (atomic config write)
   - stop the previous container (blue-green finalize)
9. Failure path: stop the NEW runtime; if the previous runtime is still healthy (Docker), the
   service rolls back to it (status stays running, deployment marked failed). For PM2 (port
   conflict prevents blue-green) the service is marked error.
10. Every subprocess has a hard timeout + tree-kill (SIGTERM→SIGKILL), so a hung build can never
    block the worker. Audit + EventBus + notification dispatch throughout; logs streamed via WS.
```

## Security model

- **Containers**: ports bound to `127.0.0.1` only — never exposed publicly
- **Traefik**: the only publicly exposed service (:80/:443); routes by container name over `ninedeploy` network. Dynamic config written atomically (temp+rename) with sanitized Host/Path operands (no rule/YAML injection)
- **Secrets**: AES-256-GCM encrypted at rest in versioned envelopes (`v<version>:iv:tag:ciphertext`). The master key is **rotatable**: add a new key under a higher version in `NINEDEPLOY_MASTER_KEYS`, restart, run the `rotateSecrets` job to re-encrypt every stored secret, then retire the old version. Legacy (pre-versioned) ciphertext still decrypts with the active key
- **Auth**: JWT (access 15m + refresh 7d) + opaque API tokens (sha256 hashed). JWTs carry a `ver` claim matched against the user's `tokenVersion`; logout / role change / password change bump it to revoke all outstanding tokens statelessly
- **Passwords**: Argon2id
- **RBAC**: admin-only for system-wide/destructive actions (sources, tunnels, notifications, system export/import/prune, user management); members manage services
- **Rate limiting**: global IP ceiling + tighter limits on `/auth/login`, `/auth/register`, `/auth/refresh`, `/setup`, and the webhook receiver (brute-force / flood defense)
- **JWT prod guard**: the server refuses to boot in production with the insecure default `NINEDEPLOY_JWT_SECRET`
- **Webhooks**: HMAC-SHA256 signature verification (GitHub/Gitea) or token comparison (GitLab)
- **Subprocess env isolation**: build/runtime commands inherit only a safe whitelist of host vars (never `NINEDEPLOY_*` secrets); runtime secrets travel via a temp `--env-file` (0600, deleted after start), not `-e KEY=VALUE` argv
- **DB backup/restore**: arg-array `docker exec` + `docker cp` only (no host `sh -c`), so a crafted DB password can never break into shell execution
- **Git credentials**: access tokens are scrubbed from `.git/config` and SSH deploy keys deleted from disk after checkout
- **Master key**: stored in `data/master.key` (0600), required to decrypt all secrets
- **CORS**: restricted to a configured allowlist (public URL + dev ports + `NINEDEPLOY_CORS_ORIGINS`), not any-origin

## Key design decisions

- **Single SQLite database** — no PostgreSQL/MongoDB/Redis dependency; everything in one file; `PRAGMA foreign_keys = ON` so cascade rules fire
- **Forward-only, additive migrations** — drizzle-kit emits no down-SQL, so rollback is manual; every migration is strictly additive (CREATE TABLE / ADD COLUMN / CREATE INDEX), so a bad migration leaves an unused object rather than data loss. To revert, drop the objects the migration created
- **Core runs bare-metal** (systemd) — direct PM2 + Docker daemon access
- **Traefik file provider** — dynamic config regenerated on every deploy/domain change
- **Container-name routing** — Traefik reaches containers by name over the shared network, not host ports
- **Blue-green (Docker) + rollback (PM2)** — Docker keeps the old container serving until the new one is healthy; PM2 can't (port conflict) so it auto-rolls back on failure
- **Image digest pinning** — each deployment records the exact image digest it ran, so rollback redeploys that precise image (not a mutable `:latest` tag)
- **Fire-and-forget notifications** — audit() → DB write + EventBus + notifier, never blocks the request
- **Bounded retention** — metrics (24h, collector), deploy logs (30d), audit log (90d), notification log (30d) pruned automatically by the housekeeping plugin so disk never fills
- **Volume retention** — DB delete keeps the volume; recreate reuses it automatically
- **TypeScript strict** — noUncheckedIndexedAccess, verbatimModuleSyntax, isolatedModules; every server source file at 100% test coverage
