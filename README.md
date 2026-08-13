# NineDeploy

Self-hosted deployment platform. Deploy apps from Git or Docker Hub in one click.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue.svg)](https://docker.com)

## What is NineDeploy?

NineDeploy is a self-hosted PaaS that runs on your own server. It wraps PM2 and Docker behind a web dashboard, gives you Traefik for HTTPS routing, and handles webhooks, managed databases, monitoring, and Cloudflare Tunnels.

You can deploy from a Git repository, a Docker image, or the built-in template hub. All data stays on your server in a single SQLite database.

## Quick start

### Option A: One-click install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/ninedeploy/ninedeploy/main/install.sh | bash
```

The installer does the following:

- Checks for Node.js >= 20, pnpm, and Docker.
- Clones the repo to `~/ninedeploy`.
- Installs dependencies and builds the project.
- Creates `.env` with a generated JWT secret.
- Runs database migrations.
- Creates and starts a systemd service.

After it finishes, open `http://your-server:3000` and create the first admin account.

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

Open `http://localhost:5173` and create the first admin account.

## First run and default credentials

NineDeploy does **not** ship with a default password. The first account created becomes the admin automatically.

When you open the dashboard for the first time, you will see a setup screen. Enter an email and a strong password. This user gets the `admin` role and can create other users later.

If you prefer the terminal, run:

```bash
npx ninedeploy setup
```

It will prompt for email, name, and password and create the first admin.

If an admin already exists, the setup screen and `ninedeploy setup` command are disabled. You must log in instead.

## Configuration

The installer creates `.env` automatically. For a manual setup, copy `.env.example` to `.env` and review at least these values:

| Variable | Default | Purpose |
|---|---|---|
| `NINEDEPLOY_HOST` | `0.0.0.0` | IP address to bind |
| `NINEDEPLOY_PORT` | `3000` | Port for the dashboard and API |
| `NINEDEPLOY_PUBLIC_URL` | `http://localhost:3000` | Public URL used for webhooks and CORS |
| `NINEDEPLOY_DATA_DIR` | `./.data` | Where SQLite, repos, logs, backups, and Traefik config are stored |
| `NINEDEPLOY_DB_PATH` | `./.data/ninedeploy.db` | SQLite database file |
| `NINEDEPLOY_JWT_SECRET` | generated | JWT signing secret (set by installer) |
| `NINEDEPLOY_JWT_ACCESS_TTL` | `15m` | Access token lifetime |
| `NINEDEPLOY_JWT_REFRESH_TTL` | `7d` | Refresh token lifetime |
| `NINEDEPLOY_MASTER_KEY` | generated | AES-256 key for encrypting secrets at rest |

The master key is generated on first start if `NINEDEPLOY_MASTER_KEY` is empty. Keep the `.env` and generated `master.key` files safe; losing them means losing stored secrets.

## Main features

- Deploy from Git, a Docker image, or the template hub.
- PM2 or Docker runtime support.
- Automatic HTTPS with Traefik.
- Webhook auto-deploy from GitHub, GitLab, or Gitea.
- Managed PostgreSQL, MySQL, Redis, and MongoDB.
- Resource monitoring with live CPU, memory, and disk usage.
- Cloudflare Tunnel support to expose services without opening ports.
- Encrypted secrets and API tokens.
- Multi-user support with role-based access.

## Using the dashboard

1. **Create a service** from the sidebar. Choose Git, Docker image, or a template.
2. **Set the port** your app listens on.
3. **Add environment variables** if needed.
4. **Set CPU and memory limits** if needed.
5. **Deploy** and watch the live log.
6. **Add a domain** and enable SSL to get HTTPS.
7. **Attach a database** to inject `DATABASE_URL` automatically.

## API overview

All API endpoints are under `/v1` and require `Authorization: Bearer <token>`, except for setup, auth, and webhooks.

### Set up the first admin

```bash
curl -X POST http://localhost:3000/v1/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret","name":"Admin"}'
```

### Log in

```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"supersecret"}'
```

Use the returned `accessToken` for all other requests:

```bash
TOKEN="eyJ..."
```

### Common endpoints

```bash
# List services
curl http://localhost:3000/v1/services -H "Authorization: Bearer $TOKEN"

# Deploy service 1
curl -X POST http://localhost:3000/v1/services/1/deploys -H "Authorization: Bearer $TOKEN"

# Create a database
curl -X POST http://localhost:3000/v1/databases \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"pg","engine":"postgres"}'

# Add a domain
curl -X POST http://localhost:3000/v1/services/1/domains \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"hostname":"api.example.com"}'
```

For the full route list, see `apps/server/src/modules/api.ts` and `apps/server/src/modules/*.ts`.

## CLI

Install the CLI globally:

```bash
pnpm --filter @ninedeploy/cli build
ln -s apps/cli/dist/index.js /usr/local/bin/ninedeploy
```

Commands:

```bash
ninedeploy setup          # create the first admin
ninedeploy login          # authenticate
ninedeploy whoami         # show current user
ninedeploy services list  # list services
ninedeploy token create   # create API token for CI
```

## Development commands

```bash
pnpm dev         # start server and web in watch mode
pnpm build       # production build
pnpm typecheck   # type-check the monorepo
pnpm db:generate # generate migration from schema changes
pnpm db:migrate  # apply migrations
pnpm db:studio   # open Drizzle Studio
pnpm clean       # remove dist and node_modules
```

## Comparison with alternatives

Based on official docs, GitHub repos, and feature pages (mid-2026).

| Feature | NineDeploy | Coolify | CapRover | Dokploy |
|---|---|---|---|---|
| **PM2 support** | ✅ native | ❌ | ❌ | ❌ (open request) |
| **SQLite (no external DB)** | ✅ | ❌ PostgreSQL | ❌ MongoDB | ❌ PostgreSQL + Redis |
| **Container loopback-only** | ✅ 127.0.0.1 | ❌ 0.0.0.0 | ❌ 0.0.0.0 | ❌ 0.0.0.0 |
| **Volume auto-reuse on recreate** | ✅ retained + reused | ⚠️ partial | ⚠️ partial | ❌ warns "data deleted" |
| **Topology graph** | ✅ React Flow | ❌ | ❌ | ❌ |
| **Container exec terminal** | ✅ xterm.js | ❌ | ❌ | ❌ |
| **One-click rollback** | ✅ | ✅ | ❌ | ❌ |
| Docker deploy | ✅ | ✅ | ✅ | ✅ |
| Image deploy (no repo) | ✅ | ✅ | ✅ | ✅ |
| Managed databases | PG/MySQL/Redis/Mongo | ✅ + more | ✅ | ✅ + more |
| Template hub | 8 apps | **280+** | **hundreds** | ~20 |
| Auto-deploy webhooks | ✅ | ✅ | ✅ | ✅ |
| Real-time deploy logs | ✅ WebSocket | ✅ WebSocket | ⚠️ partial | ✅ Redis-relay |
| Resource monitoring | ✅ sparklines | ✅ + notifications | ✅ NetData | ✅ + AI analysis |
| Cloudflare Tunnel | ✅ built-in | ✅ built-in | ❌ | ❌ guide only |
| Auto HTTPS | ✅ Traefik | ✅ | ✅ | ✅ Traefik |
| CLI | ✅ | ❌ API only | ✅ | ✅ 449 cmds |
| **License** | **MIT** | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| GitHub stars | new | **~60k** | ~15k | ~36k |

**NineDeploy unique strengths:**
- Only PaaS with **PM2 + Docker** dual support
- **SQLite** — no external database to install/maintain
- **Container security** — ports bound to `127.0.0.1` only (competitors use `0.0.0.0`)
- **Volume auto-reuse** — DB deleted → volume retained → recreated → data restored automatically
- **Interactive topology** — React Flow graph of services ↔ databases ↔ domains
- **MIT license** — most permissive

**Where competitors lead:**
- Coolify: 280+ templates, 60k+ stars, mature ecosystem, built-in CF Tunnel
- Dokploy: AI-powered debugging, MCP server, extensive CLI (449 commands), fast growth
- CapRover: Docker Swarm clustering, most battle-tested, dedicated CLI since day one

## License

MIT — see [LICENSE](./LICENSE).
