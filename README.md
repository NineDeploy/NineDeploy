# NineDeploy

Self-hosted deployment platform. Deploy apps from Git or Docker Hub in one click.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue.svg)](https://docker.com)

## What is NineDeploy?

NineDeploy is a self-hosted PaaS that runs on your own server. It wraps PM2 and Docker behind a web dashboard, gives you Traefik for HTTPS routing, and handles webhooks, managed databases, monitoring, notifications, and Cloudflare Tunnels.

You can deploy from a Git repository, a Docker image, or the built-in template hub with 49+ one-click apps. All data stays on your server in a single SQLite database — no external dependencies.

## Quick start

### Option A: One-click install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/ninedeploy/ninedeploy/main/install.sh | bash
```

### Option B: Docker (with a persistent data volume)

```bash
docker run -d --name ninedeploy \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ninedeploy-data:/data \
  -p 3000:3000 \
  -e NINEDEPLOY_JWT_SECRET=$(openssl rand -hex 32) \
  ghcr.io/ninedeploy/ninedeploy
```

All state (SQLite, repos, logs, backups, master key) lives in the `ninedeploy-data` volume; schema migrations apply automatically on startup. The host Docker socket is mounted so the deploy engine can manage your other containers. Note: PM2-based services need the bare-metal install (Option A); Docker services and templates work in both modes.

### Option C: From source (development)

```bash
git clone https://github.com/ninedeploy/ninedeploy.git
cd ninedeploy
pnpm install
cp .env.example .env
pnpm build
pnpm dev
```

Open `http://localhost:5173` and create the first admin account. Requires Node ≥ 22.13 (pnpm 11) and Docker.

## Features

### Deploy
- **Git repo** (public/private) or **Docker image** — build from source or run pre-built images
- **PM2 + Docker** — Node apps via PM2, anything via Docker/BuildKit
- **Zero-downtime deploys (Docker)** — blue-green: the new container is healthchecked before the old one retires; on failure the previous version keeps serving
- **Multi-step deploy wizard** — Source → Runtime → Environment → Resources → Review
- **Auto-deploy** — GitHub/GitLab/Gitea webhooks with HMAC signature verification
- **Live deploy logs** — real-time WebSocket streaming
- **Health checks** — container liveness + HTTP probe, automatic rollback on failure
- **One-click rollback** — redeploys the exact commit (or pinned image digest), never a moved `:latest` tag
- **Service lifecycle** — stop / start / restart from the dashboard
- **Container exec** — interactive terminal (xterm.js over WebSocket)
- **Runtime logs** — view running container output

### Infrastructure
- **Traefik** reverse proxy with **automatic HTTPS** (TLS), config updated atomically
- **Secure networking** — app containers publish no host ports at all; traffic enters via Traefik over a shared Docker network
- **Cloudflare Tunnel** — expose services without opening any ports
- **Persistent volumes** — data survives redeploys; retained volumes auto-reused on DB recreate
- **Resource limits** — CPU shares + memory caps per service and database
- **Wildcard domains** — auto-assign `{slug}.your-domain` to every service
- **Bounded retention** — metrics, deploy logs, audit log and Docker dangling images pruned automatically

### Managed Databases
- **PostgreSQL · MySQL · Redis · MongoDB** — one-click with persistent storage
- **Auto-generated credentials** — AES-256-GCM encrypted at rest
- **Connection injection** — `DATABASE_URL` auto-injected into attached services
- **Database wizard** — step-by-step creation with engine selection
- **Backups** — `pg_dump`/`mongodump` + restore + download; daily auto-backup (keep 7)

### Management
- **Dashboard** — live service health probes, stats grid, recent activity, hero status banner
- **Domain management** — centralized routing map + SSL toggle
- **Volume inventory** — list, inspect sizes, delete, Docker resources + prune
- **Monitoring** — live CPU/memory per container + sparklines + host overview
- **Template Hub** — 49+ one-click apps (n8n, Grafana, Jellyfin, Nextcloud, qBittorrent, …)
- **Topology** — interactive React Flow graph of services ↔ databases ↔ domains
- **Private repos** — PAT (HTTPS) or SSH deploy keys
- **Secrets** — encrypted env vars, masked in UI, never returned by API
- **Multi-user** — role-based access (admin/member), audit log, activity feed

### Notifications & Events
- **Event system** — every operation (deploy, create, delete, backup, …) emits a real-time event
- **Live event stream** — WebSocket-powered activity drawer with type filtering
- **Notification channels** — Telegram, Discord, generic webhook with event-type filtering
- **Notification wizard** — guided multi-step setup with test messages

### Migration
- **System export/import** — full backup (DB, master key, .env, Traefik config) as tar.gz
- **Service export/import** — move individual services between instances as JSON bundles

### UX
- **Command palette** — ⌘K / Ctrl+K fuzzy search across everything
- **Two-level menu** — activity bar (icon rail) + secondary panel, collapsible
- **Dark / Light theme** + 6 accent color palettes
- **Toast notifications** — instant feedback for all actions
- **About page** — version, changelog, tech stack, update guide

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NINEDEPLOY_HOST` | `0.0.0.0` | IP address to bind |
| `NINEDEPLOY_PORT` | `3000` | Port for the dashboard and API |
| `NINEDEPLOY_PUBLIC_URL` | `http://localhost:3000` | Public URL (webhooks, CORS) |
| `NINEDEPLOY_CORS_ORIGINS` | *(empty)* | Comma-separated extra origins allowed by CORS |
| `NINEDEPLOY_DATA_DIR` | `./.data` | SQLite, repos, logs, backups, Traefik config |
| `NINEDEPLOY_DB_PATH` | `./.data/ninedeploy.db` | SQLite database file (migrated automatically on startup) |
| `NINEDEPLOY_JWT_SECRET` | generated | JWT signing secret — **required to be custom in production** (the server refuses the insecure default) |
| `NINEDEPLOY_MASTER_KEY` | generated | AES-256 key for encrypting secrets |
| `NINEDEPLOY_MASTER_KEYS` | *(empty)* | Key ring for rotation: `0:<old-hex>,1:<new-hex>` — highest version encrypts, lower versions keep old secrets readable |
| `NINEDEPLOY_MIGRATIONS_DIR` | auto | Override the SQL migrations folder (auto-resolved otherwise) |
| `NINEDEPLOY_WILDCARD_DOMAIN` | *(empty)* | Auto-assign `{slug}.domain` URLs |

## Using the dashboard

1. **Dashboard** — overview of all services with live health status.
2. **Hub** — browse 49+ templates, configure & deploy in seconds.
3. **Services** — create from Git/image, configure env/limits/volumes, deploy.
4. **Service detail** — live logs, runtime logs, exec terminal, domains, databases, env, webhooks, lifecycle controls, rollback, export.
5. **Databases** — create via wizard, attach to services, back up & restore.
6. **Domains** — routing map, SSL toggle per domain.
7. **Volumes** — inventory, sizes, Docker resources + prune.
8. **Topology** — visual graph of all connections.
9. **Monitoring** — live CPU/mem sparklines + host resources.
10. **Backups** — list, restore, download.
11. **Tunnels** — Cloudflare Tunnel management.
12. **Sources** — private repo credentials.
13. **Users** — team management, role toggle.
14. **Settings** — theme, accent, wildcard domain, notifications, system migration.
15. **About** — version, changelog, tech stack.

## API overview

All endpoints under `/v1`, require `Authorization: Bearer <token>` (except auth/setup/hooks/events).

```bash
# Setup
curl -X POST http://localhost:3000/v1/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret","name":"Admin"}'

# Login
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret"}'

# Deploy
curl -X POST http://localhost:3000/v1/services/1/deploys -H "Authorization: Bearer $TOKEN"

# Stop / Start / Restart
curl -X POST http://localhost:3000/v1/services/1/stop -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/v1/services/1/restart -H "Authorization: Bearer $TOKEN"

# Container exec logs
curl http://localhost:3000/v1/services/1/logs -H "Authorization: Bearer $TOKEN"

# Export service
curl -OJ http://localhost:3000/v1/services/1/export -H "Authorization: Bearer $TOKEN"

# Dashboard overview
curl http://localhost:3000/v1/dashboard -H "Authorization: Bearer $TOKEN"

# System export
curl -OJ http://localhost:3000/v1/system/export -H "Authorization: Bearer $TOKEN"
```

## CLI

```bash
ninedeploy setup          # create the first admin
ninedeploy login          # authenticate
ninedeploy whoami         # show current user
ninedeploy services list  # list services
ninedeploy token create   # create API token for CI
```

## Development

```bash
pnpm dev         # server + web in watch mode (migrations apply on startup)
pnpm build       # production build
pnpm typecheck   # type-check the monorepo
pnpm test        # run the full test suite (all packages, 100% coverage gates)
pnpm db:generate # generate migration from schema changes
pnpm db:migrate  # apply migrations manually (optional — the server self-migrates)
pnpm db:studio   # open Drizzle Studio
pnpm clean       # remove dist and node_modules
```

## License

MIT — see [LICENSE](./LICENSE).
