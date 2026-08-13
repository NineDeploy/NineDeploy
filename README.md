<div align="center">

# 🚀 NineDeploy

### Self-hosted deployment platform — deploy apps from Git or Docker Hub in one click.

PM2 + Docker · Traefik HTTPS · Webhooks · Managed Databases · Monitoring · Template Hub · Cloudflare Tunnels

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue.svg)](https://docker.com)

</div>

---

## 📸 Dashboard Preview

```
 ┌─────────┬──────────────────────────────────────────────────────────────┐
 │         │                                                              │
 │  9 Nine │  Services                                          [+ New]   │
 │  Deploy │  Deploy and manage your applications.                        │
 │         │                                                              │
 │ ▸ Hub   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
 │ ▸ Servi │  │ 🟢 my-api    │  │ 🔵 blog      │  │ 🟢 webhook   │      │
 │ ▸ Datab │  │ docker·main  │  │ docker·main  │  │ pm2·prod     │      │
 │ ▸ Domai │  │ :3000        │  │ :8080        │  │ :4000        │      │
 │ ▸ Tunne │  └──────────────┘  └──────────────┘  └──────────────┘      │
 │ ▸ Topol │                                                      [A]     │
 │ ▸ Backu │  ┌──────────────┐  ┌──────────────┐                     ad │
 │ ▸ Sourc │  │ 🟡 worker    │  │ 🔴 stale-api │                     min │
 │ ▸ Monit │  │ docker·dev   │  │ docker·main  │                     @n │
 │         │  └──────────────┘  └──────────────┘                     ine│
 │ [A]admi │                  ↳ Recent: deploy my-api · 2m ago         │
 │  ↳ Sign │                                                              │
 └─────────┴──────────────────────────────────────────────────────────────┘
```

### Template Hub
```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ✨ Hub — One-click apps                            [🔍 Search...]   │
 │                                      [All] [Automation] [Monitoring] │
 │                                                                      │
 │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
 │  │ 🔗 n8n          │  │ 📊 Uptime Kuma  │  │ 📈 Grafana      │     │
 │  │ ⭐ featured      │  │ ⭐ featured      │  │ Dashboards      │     │
 │  │ Workflow auto.. │  │ Monitoring tool │  │ & observability │     │
 │  │ [Automation]    │  │ [Monitoring]    │  │ [Monitoring]    │     │
 │  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
 │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
 │  │ 🔐 Vaultwarden  │  │ 🗄️ Adminer     │  │ 📝 Memos        │     │
 │  │ ⭐ Password mgr  │  │ DB management   │  │ Note-taking     │     │
 │  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
 └──────────────────────────────────────────────────────────────────────┘
```

### Service Detail (Deploy + Logs + Lifecycle)
```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  ← Services                                                         │
 │                                                                      │
 │  my-api  🟢 running          [Deploy] [↻ Restart] [⬛ Stop] [_logs] │
 │  my-api · docker · main · :3000                                     │
 │                                                                      │
 │  ┌─── Domains ──────┐  ┌─── Databases ───┐  ┌─── Deploy log ─────┐ │
 │  │ api.example.com  │  │ pg → DATABASE_  │  │ ● ● ●  deploy #12   │ │
 │  │ admin.ex.com     │  │     URL         │  │                      │ │
 │  │ [+ Add domain]   │  │ [+ Attach]      │  │ ▶ Deployment #12    │ │
 │  └──────────────────┘  └─────────────────┘  │ Cloning repo…        │ │
 │  ┌─── Env vars ─────┐  ┌─── Auto-deploy ─┐  │ Building image…     │ │
 │  │ NODE_ENV prod    │  │ POST /hooks/1   │  │ Starting container.. │ │
 │  │ API_KEY ••• sec  │  │ main branch     │  │ ✓ Success            │ │
 │  └──────────────────┘  └─────────────────┘  └──────────────────────┘ │
 └──────────────────────────────────────────────────────────────────────┘
```

### Monitoring
```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  📊 Monitoring                                                       │
 │                                                                      │
 │  ┌── CPU ────┐  ┌── Memory ───┐  ┌── Disk ─────┐  ┌── Workloads ─┐ │
 │  │ 10 cores  │  │  62%        │  │  42%        │  │ 4 containers │ │
 │  │ load 1.23 │  │ 14.9/24 GB  │  │ 193/460 GB  │  │ running      │ │
 │  └───────────┘  └─────────────┘  └─────────────┘  └──────────────┘ │
 │                                                                      │
 │  my-api     CPU 0.42%  Mem 128MB  ▁▂▃▅▆▇▆▅▃▂  [cpu: 512 mem: 256] │
 │  pg         CPU 0.01%  Mem  46MB                    [cpu: — mem: —] │
 └──────────────────────────────────────────────────────────────────────┘
```

### Topology (React Flow)
```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  🔀 Topology — How everything connects                              │
 │                                                                      │
 │  api.example.com ──→ ┌──────────┐  DATABASE_URL  ┌──────────┐       │
 │                      │ my-api   │ ──────────────→ │ pg       │       │
 │                      │ docker   │                 │ postgres │       │
 │                      │ running  │                 │ running  │       │
 │                      └──────────┘                 └──────────┘       │
 │                                                                      │
 │  admin.ex.com ─────→ ┌──────────┐                                   │
 │                      │ blog     │                                   │
 │                      │ docker   │                                   │
 │                      └──────────┘                                   │
 └──────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

### 🚀 Deploy
- **Git repo** (public/private) or **Docker image** — build from source or run pre-built images
- **PM2 + Docker** — Node apps via PM2 process manager, anything else via Docker/BuildKit
- **Multi-step deploy wizard** — Source → Runtime → Environment → Resources → Review
- **Auto-deploy** — GitHub/GitLab/Gitea webhooks with HMAC signature verification
- **Live deploy logs** — real-time WebSocket streaming
- **Health checks** — automatic probing with rollback on failure
- **Service lifecycle** — stop / start / restart from the dashboard
- **Runtime container logs** — `docker logs` streaming

### 🌐 Infrastructure
- **Traefik** reverse proxy with **automatic HTTPS** (TLS / Let's Encrypt ready)
- **Secure networking** — containers NOT exposed publicly (loopback only); all traffic via Traefik
- **Cloudflare Tunnel** — expose services without opening any ports
- **Persistent volumes** — data survives redeploys; retained volumes auto-reused on DB recreate
- **Resource limits** — CPU shares + memory caps per service and database

### 🗄️ Managed Databases
- **PostgreSQL · MySQL · Redis · MongoDB** — one-click with persistent storage
- **Auto-generated credentials** — AES-256-GCM encrypted at rest
- **Connection injection** — `DATABASE_URL` auto-injected into attached services
- **Backups** — `pg_dump`/`mongodump` + restore + download; daily auto-backup (keep 7)

### 📊 Management
- **Domain management** — centralized routing map, SSL toggle, target visibility
- **Volume inventory** — list, inspect sizes, delete retained volumes, Docker resources + prune
- **Monitoring** — live CPU/memory per container + host overview + sparkline charts
- **Private repos** — PAT (HTTPS) or SSH deploy keys
- **Template Hub** — 8 one-click apps (n8n, Grafana, Uptime Kuma, Vaultwarden, …)
- **Topology** — interactive React Flow graph of services ↔ databases ↔ domains
- **Secrets** — encrypted env vars, masked in UI, never returned by API
- **Audit log** — activity feed tracking deploys and changes

### 🔒 Security
- JWT sessions (access + refresh) · API tokens for CLI/CI
- Argon2 password hashing · First user = admin
- Containers bound to 127.0.0.1 (not publicly exposed)
- AES-256-GCM encryption for all secrets at rest
- HMAC webhook signature verification

---

## 🚀 Quick Start

### Option A: One-click install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/ninedeploy/ninedeploy/main/install.sh | bash
```

The installer checks for Node.js ≥ 20, pnpm, and Docker; clones, builds, migrates, and starts a systemd service.

```
ℹ  Node.js v20.10.0
✓  pnpm 9.15.0
✓  Docker 27.3.1
ℹ  Cloning NineDeploy…
ℹ  Installing dependencies…
ℹ  Building…
ℹ  Creating .env with generated secrets…
ℹ  Running database migrations…
ℹ  Setting up systemd service…
✓  NineDeploy service started (systemd)

╔══════════════════════════════════════════╗
║       ✓ Installation Complete            ║
╚══════════════════════════════════════════╝

  Dashboard:  http://your-server:3000
  Next: open the URL → create admin account → deploy!
```

### Option B: From source (development)

```bash
git clone https://github.com/ninedeploy/ninedeploy.git
cd ninedeploy
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm build
pnpm dev
```

Open `http://localhost:5173` → create admin → deploy.

---

## 📖 User Guide

### 1. Deploy your first app

**From Git:**
1. Click **New service** in the sidebar
2. Wizard Step 1: enter name, choose Docker, paste repo URL, select branch
3. Step 2: set port (the port your app listens on)
4. Step 3: add environment variables (optional)
5. Step 4: set CPU/memory limits (optional)
6. Step 5: review → **Deploy**
7. Watch live build logs → status turns 🟢 running

**From Hub (one-click app):**
1. Go to **Hub** in the sidebar
2. Browse templates (n8n, Grafana, Uptime Kuma, …)
3. Click a template → **Configure & deploy**
4. Adjust port/env if needed → **Deploy**

**From Docker image:**
1. **New service** → toggle to **Image** mode
2. Enter image (e.g., `redis:7`) → configure → deploy

### 2. Add a custom domain

1. Go to service detail → **Domains** card
2. Enter hostname (e.g., `api.mydomain.com`) → **Add**
3. Point your DNS A record to the server IP
4. Go to **Domains** page → toggle **SSL** for HTTPS
5. Done — Traefik routes `https://api.mydomain.com` → your container

### 3. Set up auto-deploy (webhooks)

1. Service detail → **Auto-deploy** card → **New**
2. Copy the **Payload URL** and **Secret** (shown once!)
3. In GitHub: repo → Settings → Webhooks → Add webhook
4. Paste URL, set Content-Type = JSON, paste secret, select `push` events
5. Now every `git push` triggers an automatic deploy 🔁

### 4. Create a managed database

1. Go to **Databases** → **New database**
2. Wizard: pick engine (🐘 Postgres, 🐬 MySQL, ⚡ Redis, 🍃 Mongo)
3. Enter name → review → **Create**
4. Auto: container starts, volume created, credentials generated
5. Copy the connection string from the database card

### 5. Connect a service to a database

1. Service detail → **Databases** card → select a database → **Attach**
2. `DATABASE_URL` (or `REDIS_URL`) is auto-injected on next deploy
3. Redeploy the service — it now has DB access

### 6. Monitor resources

1. Go to **Monitoring** in the sidebar
2. View host overview (CPU cores, memory bar, disk bar)
3. Per-container: live CPU%, memory, sparkline trend
4. Set CPU/memory limits per container (Monitoring or service detail)

### 7. Back up and restore

1. **Databases** page → click **Backup** on a database
2. Go to **Backups** page → see the snapshot
3. **Restore** (overwrites current data) or **Download** (.dump file)
4. Daily auto-backup runs at midnight, keeps latest 7 per database

### 8. Expose without opening ports (Cloudflare Tunnel)

1. Create a tunnel in [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) dashboard
2. Copy the tunnel **token**
3. Go to **Tunnels** → **New tunnel** → paste token → **Start**
4. In Cloudflare: map public hostnames to `http://ninedeploy-traefik:80`
5. Your domains are now served through the tunnel — zero open ports 🔒

---

## 📡 API Reference

All endpoints are under `/v1` and require `Authorization: Bearer <token>` (except auth/setup/hooks).

### Auth
```bash
# Setup (first admin, only works when no users exist)
curl -X POST http://localhost:3000/v1/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret"}'

# Login
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret"}'
# → {"user":{...},"tokens":{"accessToken":"eyJ...","refreshToken":"eyJ...","expiresIn":900}}

# Use the token
TOKEN="eyJ..."
```

### Services
```bash
# List
curl http://localhost:3000/v1/services -H "Authorization: Bearer $TOKEN"

# Create (from repo)
curl -X POST http://localhost:3000/v1/services \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-api","type":"docker","repoUrl":"https://github.com/me/repo","port":3000}'

# Create (from image)
curl -X POST http://localhost:3000/v1/services \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"redis","type":"docker","image":"redis:7","port":6379}'

# Deploy
curl -X POST http://localhost:3000/v1/services/1/deploys -H "Authorization: Bearer $TOKEN"

# Stop / Start / Restart
curl -X POST http://localhost:3000/v1/services/1/stop -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/v1/services/1/start -H "Authorization: Bearer $TOKEN"

# Runtime logs
curl http://localhost:3000/v1/services/1/logs -H "Authorization: Bearer $TOKEN"
```

### Databases
```bash
# Create PostgreSQL
curl -X POST http://localhost:3000/v1/databases \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"pg","engine":"postgres"}'
# → {"id":1,"connectionString":"postgres://nine:...@nd-db-pg:5432/app",...}

# Backup
curl -X POST http://localhost:3000/v1/databases/1/backups -H "Authorization: Bearer $TOKEN"

# Attach to service (injects DATABASE_URL)
curl -X POST http://localhost:3000/v1/services/1/attachments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"databaseId":1,"envAlias":"DATABASE_URL"}'
```

### Domains
```bash
# Add domain
curl -X POST http://localhost:3000/v1/services/1/domains \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"hostname":"api.example.com"}'

# Toggle SSL
curl -X PATCH http://localhost:3000/v1/domains/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ssl":true}'
```

### Webhooks
```bash
# Create webhook (returns secret once)
curl -X POST http://localhost:3000/v1/services/1/webhooks \
  -H "Authorization: Bearer $TOKEN"
# → {"url":"http://your-host/v1/hooks/1","secret":"abc123..."}

# GitHub sends: X-Hub-Signature-256 + push payload → auto-deploy
```

### Templates (Hub)
```bash
# List
curl http://localhost:3000/v1/templates -H "Authorization: Bearer $TOKEN"

# Deploy template
curl -X POST http://localhost:3000/v1/templates/uptime-kuma/deploy \
  -H "Authorization: Bearer $TOKEN"
```

### Monitoring
```bash
# Live stats
curl http://localhost:3000/v1/stats -H "Authorization: Bearer $TOKEN"

# CPU time series (last 60 min)
curl "http://localhost:3000/v1/services/1/metrics?kind=cpu&minutes=60" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 💻 CLI

```bash
# Install globally (optional)
pnpm --filter @ninedeploy/cli build
ln -s apps/cli/dist/index.js /usr/local/bin/ninedeploy

# Commands
ninedeploy setup          # Create first admin (interactive)
ninedeploy login          # Authenticate
ninedeploy whoami         # Show current user
ninedeploy services list  # List services
ninedeploy token create   # Create API token (for CI)
ninedeploy token list     # List API tokens
```

---

## 🏗️ Architecture

```
                    ┌──────────────────────────────────────────┐
                    │           NineDeploy Core                │
   User ───────────│          (Fastify, systemd)              │
   │  WebUI / CLI  │                                          │
   │               │  ┌────────────────────────────────────┐  │
   └──────────────▶│  │ Deploy Engine                       │  │
                    │  │  Git clone → Build → Run → Health   │  │
                    │  │  PM2 builder | Docker builder       │  │
                    │  │  SQLite job queue (worker)          │  │
                    │  │  WebSocket live logs                │  │
                    │  └────────────────────────────────────┘  │
                    │  ┌──────────┐ ┌────────┐ ┌───────────┐  │
                    │  │ Traefik  │ │ AES    │ │ Collector │  │
                    │  │ :80/:443 │ │ crypto │ │ (metrics) │  │
                    │  └──────────┘ └────────┘ └───────────┘  │
                    └───────────┬──────────────┬───────────────┘
                                │              │
                    ┌───────────▼───┐  ┌──────▼──────┐
                    │  App          │  │ Database    │
                    │  containers   │  │ containers  │
                    │  (PM2/Docker) │  │ (PG/MySQL/  │
                    │  127.0.0.1    │  │  Redis/Mongo)│
                    │  only         │  │ + volumes   │
                    └───────────────┘  └─────────────┘
                         ↑                                   ↑
                    ┌────┴───────────────────────────────────┘
                    │     ninedeploy Docker network          │
                    │     (Traefik resolves containers       │
                    │      by name — no host ports)          │
                    └────────────────────────────────────────┘
```

**Key design decisions:**
- **Core runs bare-metal** (systemd) for direct PM2 + Docker daemon access
- **Single SQLite database** — no external DB dependency
- **Containers are NOT publicly exposed** — only Traefik (:80/:443) is exposed; everything else is loopback-only
- **Traefik routes by container name** over the shared Docker network (not host ports)
- **Secrets encrypted** at rest with AES-256-GCM (master key auto-generated)

---

## 📂 Project Structure

```
ninedeploy/
├── apps/
│   ├── server/              # Fastify API + deploy engine
│   │   ├── src/
│   │   │   ├── engine/      # pipeline, builders (docker/pm2), database, proxy, tunnel
│   │   │   ├── modules/     # routes: auth, services, deploys, databases, domains,
│   │   │   │                #   hooks, templates, stats, backups, volumes, tunnels…
│   │   │   ├── plugins/     # fastify plugins: db, auth, worker, traefik, collector
│   │   │   ├── lib/         # crypto, git, exec, jwt, slug, errors, audit
│   │   │   └── templates/   # template registry (hub)
│   │   └── Dockerfile
│   ├── web/                 # React 19 + Vite 8 + Tailwind v4
│   │   └── src/
│   │       ├── routes/      # pages: Services, Hub, Databases, Domains, Monitoring,
│   │       │                #   Topology, Volumes, Backups, Tunnels, Sources, Login
│   │       ├── components/  # ui.tsx, Layout, DeployWizard, DatabaseWizard, etc.
│   │       └── lib/         # api (SDK), auth, useDeployLogs
│   └── cli/                 # `ninedeploy` CLI (commander)
├── packages/
│   ├── db/                  # Drizzle ORM schema + migrations (single source of truth)
│   ├── schemas/             # Zod validation schemas (shared)
│   └── sdk/                 # Typed API client (used by web + cli)
├── systemd/                 # ninedeploy.service
├── install.sh               # One-click installer
├── ARCHITECTURE.md          # Detailed architecture
└── README.md                # You are here
```

---

## 🔧 Configuration

| Variable | Default | Description |
|---|---|---|
| `NINEDEPLOY_HOST` | `0.0.0.0` | Listen address |
| `NINEDEPLOY_PORT` | `3000` | API + dashboard port |
| `NINEDEPLOY_PUBLIC_URL` | `http://localhost:3000` | Public URL (webhooks, CORS) |
| `NINEDEPLOY_DATA_DIR` | `./.data` | Data dir (db, repos, logs, backups, traefik) |
| `NINEDEPLOY_DB_PATH` | `./.data/ninedeploy.db` | SQLite database file |
| `NINEDEPLOY_JWT_SECRET` | *(required)* | JWT signing secret (auto-generated by installer) |
| `NINEDEPLOY_JWT_ACCESS_TTL` | `15m` | Access token lifetime |
| `NINEDEPLOY_JWT_REFRESH_TTL` | `7d` | Refresh token lifetime |
| `NINEDEPLOY_MASTER_KEY` | *(auto)* | AES-256 encryption key for secrets |

---

## 🛠️ Development

```bash
pnpm dev              # start server + web in watch mode
pnpm build            # production build (all packages)
pnpm typecheck        # type-check the whole monorepo
pnpm db:generate      # generate migration from schema changes
pnpm db:migrate       # apply migrations
pnpm db:studio        # open Drizzle Studio (DB GUI)
pnpm clean            # remove all dist + node_modules
```

---

## 🆚 Comparison

| Feature | NineDeploy | Coolify | CapRover | Dokploy |
|---|---|---|---|---|
| Self-hosted | ✅ | ✅ | ✅ | ✅ |
| Docker + PM2 | ✅ both | Docker only | Docker only | Docker only |
| Managed databases | ✅ PG/MySQL/Redis/Mongo | ✅ | ✅ | ✅ |
| Template hub | ✅ 8 apps | ✅ | ✅ | ✅ |
| Auto-deploy webhooks | ✅ GitHub/GitLab/Gitea | ✅ | ✅ | ✅ |
| Real-time deploy logs | ✅ WebSocket | ✅ | ❌ | ✅ |
| Resource monitoring | ✅ live + sparklines | ✅ | ❌ | ✅ |
| Cloudflare Tunnel | ✅ built-in | ❌ | ❌ | ❌ |
| Volume retention + reuse | ✅ | ❌ | ❌ | ❌ |
| Image-based deploy | ✅ no repo needed | ✅ | ✅ | ✅ |
| Deploy wizard (multi-step) | ✅ | ❌ | ❌ | ❌ |
| SQLite (no external DB) | ✅ | ❌ PG | ❌ Mongo | ❌ PG |
| Container security (loopback) | ✅ | ❌ | ❌ | ❌ |
| Topology graph | ✅ React Flow | ❌ | ❌ | ❌ |

---

## 📄 License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">

Built with ❤️ using TypeScript, React, Fastify, Drizzle, Traefik, and Docker.

</div>
