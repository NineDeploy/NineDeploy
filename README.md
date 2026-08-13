# NineDeploy

Self-hosted, **one-click** deployment platform. Pull code from GitHub/GitLab, build it,
and run it with **PM2** or **Docker**, fronted by **Traefik** with automatic HTTPS.
CLI + WebUI, webhooks for auto-deploy, encrypted secrets, backups and monitoring.

> Status: scaffold (F0). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design
> and the phased roadmap.

## Stack

- **Runtime:** Node.js ≥ 20 · TypeScript (strict)
- **Monorepo:** pnpm workspaces + Turborepo
- **API:** Fastify · Zod · WebSocket
- **DB:** SQLite (libSQL) · Drizzle ORM
- **Deploy targets:** PM2 (native) + Docker (BuildKit/Nixpacks)
- **Proxy:** Traefik (auto-HTTPS)
- **WebUI:** React + Vite + Tailwind + shadcn/ui
- **CLI:** Commander (shares the typed SDK)

## Repository layout

```
apps/
  server/   Fastify API + deploy engine (runs via systemd)
  web/      React dashboard
  cli/      `ninedeploy` command
packages/
  db/       Drizzle schema + migrations (single source of truth)
  schemas/  Zod request/response schemas
  sdk/      Typed API client (used by web + cli)
```

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:generate     # create initial migration
pnpm db:migrate      # apply it
pnpm build           # build all packages/apps
pnpm dev             # run server + web + cli watches concurrently
```

- API: http://localhost:3000/health
- WebUI: http://localhost:5173

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run all packages/apps in watch mode |
| `pnpm build` | Build everything (respecting dependency order) |
| `pnpm typecheck` | Type-check the whole monorepo |
| `pnpm db:generate` | Generate a new Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## License

MIT
