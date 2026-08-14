# NineDeploy

Self-hosted deployment platform. Deploy apps from Git or a container registry in one click — with zero-downtime releases, automatic rollback, managed databases, HTTPS routing, and a full security model.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue.svg)](https://docker.com)
[![CI](https://github.com/NineDeploy/NineDeploy/actions/workflows/ci.yml/badge.svg)](https://github.com/NineDeploy/NineDeploy/actions/workflows/ci.yml)

## What is NineDeploy?

NineDeploy is a self-hosted PaaS that runs on your own server. It wraps PM2 and Docker behind a web dashboard and CLI, gives you Traefik for HTTPS routing, and handles webhooks, managed databases, monitoring, notifications, and Cloudflare Tunnels.

Deploy from a Git repository, a container image, or the built-in template hub with 49+ one-click apps. All state stays on your server in a single SQLite database — no external dependencies. Every source file across the monorepo is held at **100% test coverage**, enforced in CI.

## Quick start

### Option A: One-click install (Linux, bare-metal — recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/NineDeploy/NineDeploy/main/install.sh | bash
```

Bare-metal is the recommended production mode: the core runs under systemd with direct Docker daemon + PM2 access.

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

- **Git repo** (public/private via PAT or SSH deploy key) or **container image** — build from source or run pre-built images
- **Zero-downtime releases (Docker)** — blue-green: the new container is healthchecked *before* the old one retires; on failure the previous version keeps serving (automatic rollback)
- **Health checks** — container liveness (`docker inspect`) + HTTP probe on the container's network IP, per-attempt timeouts, hard deadline
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

- **PostgreSQL · MySQL · Redis · MongoDB** — one-click with persistent storage; idempotent start (no name conflicts)
- **Auto-generated credentials** — encrypted at rest; `DATABASE_URL`-style connection strings auto-injected into attached services
- **Backups** — `pg_dump`/`mysqldump`/`mongodump`/RDB snapshot + restore + download — **encrypted at rest** with the master key (legacy plaintext backups still restore); daily auto-backup keeps the last 7 **scheduled** backups and never touches manual ones
- **Bounded retention** — metrics (24 h), deploy logs (30 d), audit log (90 d), notification log (30 d), dangling Docker images — pruned automatically

## Management

- **Dashboard** — live health probes, stats grid, recent activity
- **Domain management** — routing map + SSL toggle; wildcard auto-assign (`{slug}.your-domain`)
- **Monitoring** — live CPU/memory per container + host overview
- **Template Hub** — 49+ one-click apps (n8n, Grafana, Jellyfin, Nextcloud, …)
- **Topology** — interactive graph of services ↔ databases ↔ domains
- **Notifications** — Telegram / Discord / webhooks with event filters, timeouts, and HTML-safe messages
- **Multi-user** — roles, audit log, activity feed, registration toggle
- **Migration** — full system export/import (with rollback) and per-service bundles (admin-only; bundles contain plaintext secrets)
- **CLI** — `setup · login · logout · whoami · services · token`
- **UX** — command palette (⌘K), dark/light + 6 accents, toasts

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
| `NINEDEPLOY_ACME_EMAIL` | *(empty)* | Let's Encrypt registration email — enables automatic HTTPS (the domain SSL toggle then issues real certificates via Traefik ACME) |

## API

All endpoints under `/v1` require `Authorization: Bearer <token>` (except auth/setup/hooks/events/status).

```bash
# Setup (first admin) / login / refresh / logout
curl -X POST http://localhost:3000/v1/setup -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret","name":"Admin"}'
curl -X POST http://localhost:3000/v1/auth/login   -d '{"email":"…","password":"…"}'
curl -X POST http://localhost:3000/v1/auth/logout  -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/v1/auth/password -H "Authorization: Bearer $TOKEN" \
  -d '{"currentPassword":"…","newPassword":"…"}'        # revokes other sessions

# Deploy / rollback
curl -X POST http://localhost:3000/v1/services/1/deploys -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/v1/services/1/deploys/7/rollback -H "Authorization: Bearer $TOKEN"

# Admin: registration toggle / password reset
curl http://localhost:3000/v1/settings -H "Authorization: Bearer $ADMIN"
curl -X PUT http://localhost:3000/v1/settings/allow-registration -H "Authorization: Bearer $ADMIN" \
  -d '{"enabled":false}'
curl -X PATCH http://localhost:3000/v1/users/2/password -H "Authorization: Bearer $ADMIN" \
  -d '{"newPassword":"fresh-pass-123"}'
```

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

CI runs typecheck, lint, build, the full test suite, and a Docker image build on every PR; releases publish the image to GHCR on tags. Integration tests (real PostgreSQL via testcontainers) live under `apps/server/test/integration/` and run with `RUN_INTEGRATION=1`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system diagram, deploy pipeline, and design decisions.

## License

MIT — see [LICENSE](./LICENSE).
