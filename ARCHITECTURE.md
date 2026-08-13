# NineDeploy — Architecture

A self-hosted, single-server deployment platform installed with one command.
The core server runs **bare-metal (systemd)** so it has direct, unimpeded access to
both the host **PM2** process manager and the host **Docker** daemon (via `docker.sock`).
**Traefik** runs as a sibling container and routes traffic + terminates TLS.

```
                 ┌─────────────────────────────────────────────┐
   User ───────▶ │   WebUI (React/Vite)      CLI (`ninedeploy`) │
                 └──────────────┬───────────────────┬───────────┘
                                │  REST + WebSocket  │ (api token)
                                ▼                    ▼
                 ┌──────────────────────────────────────────────┐
                 │       NineDeploy Core (Fastify, systemd)     │
                 │  Auth · Secrets · Webhooks · Backup · Monitor│
                 │  ─────────────── Deploy Engine ───────────── │
                 │   Git → Build(Nixpacks/BuildKit) → Run       │
                 └───────┬───────────────────┬──────────┬───────┘
                         ▼                   ▼          ▼
                   ┌──────────┐       ┌───────────┐  ┌──────────┐
                   │ PM2 API  │       │ Docker    │  │ SQLite   │
                   │ (Node)   │       │ (dockerode│  │ (state)  │
                   └────┬─────┘       └─────┬─────┘  └──────────┘
                        │                  │
                        ▼                  ▼
                 ┌──────────────────────────────────────────────┐
                 │   Traefik (container) — HTTPS, domain routing │
                 └──────────────────────────────────────────────┘
```

## Core decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Runtime model | Core on host via systemd | Direct PM2 + Docker access; avoids docker-in-docker |
| Deploy targets | PM2 **and** Docker | Node-native apps via PM2; anything via Docker |
| Builds | BuildKit (buildx) + Nixpacks | Cached multi-stage builds; Dockerfile-less auto-detection |
| Proxy | Traefik (label + file providers) | Dynamic routing, automatic Let's Encrypt |
| DB | SQLite (libSQL) + Drizzle | Zero-ops, single file, TS-first ORM |
| Queue | SQLite-backed job runner | No Redis dependency — stays one-click |
| Secrets | AES-256-GCM at rest | Master key in data dir; injected as env at deploy time |

## Data model (SQLite)

```
users          id, email, password_hash, name, role(admin|member), timestamps
api_tokens     id, user_id, name, hash, scopes, last_used_at
projects       id, name, slug, description, timestamps
services       id, project_id, name, slug, type[pm2|docker], repo_url, branch,
               commit_sha, port, status, timestamps
build_configs  id, service_id, build_pack, base_dir, install_cmd, build_cmd,
               start_cmd, dockerfile_path
deployments    id, service_id, status, commit_sha, message, author,
               trigger[user|webhook|cli], log_path, started_at, finished_at
env_vars       id, service_id, key, value_encrypted, is_secret
sources        id, type[github|gitlab|gitea|custom], name, token_encrypted, default_branch
domains        id, service_id, hostname, path, ssl, redirect_www, status
webhooks       id, source_id, service_id, branch, events[], secret_encrypted, active
backups        id, scope[db|volumes], status, path, size, created_at
metrics        id, service_id, kind, value, ts          (rotated)
audit_log      id, user_id, action, entity, meta_json, ts
settings       key, value
```

## Deploy pipeline

1. **Trigger** (manual / webhook / CLI) → create `deployment` row (`queued`)
2. **Job runner** picks it up → `building`
3. **Source**: clone/fetch into `data/repos/<service>`, checkout exact commit
4. **Pre-build hook** (optional user script)
5. **Build**
   - PM2: run install + build commands, generate `ecosystem.config.cjs`
   - Docker: `docker buildx build` if a Dockerfile exists, otherwise Nixpacks
6. **Stop old runtime** (`pm2 delete` / `docker stop`)
7. **Start new runtime** (PM2 ecosystem / docker run with Traefik labels)
8. **Healthcheck**; on failure → **rollback** to previous deployment
9. **Promote**: activate domains, prune old artifacts, mark `running`
10. Logs stream over WebSocket and are persisted

## Security

- argon2 password hashing; JWT access (short) + refresh (rotating)
- Scoped API tokens for the CLI
- HMAC signature verification on all inbound webhooks
- Secrets encrypted at rest, masked in logs, never returned by the API

## Phased roadmap

| Phase | Scope | Outcome |
| --- | --- | --- |
| F0 | Monorepo, tsconfig/eslint, full Drizzle schema, Fastify skeleton, health | Compiling skeleton |
| F1 | Auth (register/login/JWT), CRUD for services/projects, SDK, CLI login | `ninedeploy login` |
| F2 | Deploy engine: git, PM2 + Docker builders, pipeline, live logs | First real deploy |
| F3 | WebUI: dashboard, service form, deploy trigger, live logs, domains | Full dashboard |
| F4 | Traefik integration, automatic HTTPS, route management | Live domains |
| F5 | Webhooks + auto-deploy (GitHub/GitLab signatures) | Push → deploy |
| F6 | Encrypted secrets management + injection | Secure secrets |
| F7 | Backups + monitoring (metrics, uptime, log archive) | Operational |
| F8 | Installer script, docs, RBAC, multi-user | v1.0 |
