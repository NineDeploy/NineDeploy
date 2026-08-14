# ── NineDeploy container image ───────────────────────────────────────────
# NOTE: the recommended production setup is bare-metal (install.sh + systemd)
# because the core needs direct Docker daemon + PM2 access. This image is for
# CI build verification and OPTIONAL containerized deploys — run it with the
# host Docker socket mounted so the deploy engine can manage sibling containers:
#
#   docker run -d --name ninedeploy \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     -v ninedeploy-data:/data \
#     -p 3000:3000 \
#     -e NINEDEPLOY_DATA_DIR=/data \
#     -e NINEDEPLOY_DB_PATH=/data/ninedeploy.db \
#     -e NINEDEPLOY_JWT_SECRET=<strong-secret> \
#     -e NINEDEPLOY_PUBLIC_URL=https://your-host \
#     ghcr.io/ninedeploy/ninedeploy
#
# PM2-based services are not available in this mode (the daemon runs in the
# host PID space); Docker-based services and templates work normally.

# ── Stage 1: build the monorepo ──────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# Install pnpm via corepack (no network fetch of package managers).
RUN corepack enable

# Copy workspace manifests first for layer-cached installs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/db/package.json packages/db/
COPY packages/schemas/package.json packages/schemas/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile

# Copy the rest and build (tsc for server/packages, vite for web).
COPY . .
RUN pnpm build

# ── Stage 2: runtime ─────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# docker CLI: the deploy engine shells out to `docker` (via the mounted socket).
# git: repo checkouts. tini: proper signal handling / zombie reaping as PID 1.
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io git tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Production dependencies only (dev deps are stripped). apps/web's manifest is
# copied just to satisfy the workspace resolution — its deps are never installed
# into the runtime (--filter keeps it to what apps/server imports).
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/apps/cli/package.json apps/cli/
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/schemas/package.json packages/schemas/
COPY --from=build /app/packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile --prod --filter @ninedeploy/server... 

# Compiled output (the templates registry compiles into dist; the dashboard is
# a separate static bundle deployed alongside, not served by the API).
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/packages/sdk/dist packages/sdk/dist

# Non-root user; /data is the volume mount point for db/repos/logs/backups.
RUN useradd --system --create-home ninedeploy && mkdir -p /data && chown ninedeploy /data
USER ninedeploy

ENV NODE_ENV=production \
    NINEDEPLOY_HOST=0.0.0.0 \
    NINEDEPLOY_PORT=3000 \
    NINEDEPLOY_DATA_DIR=/data \
    NINEDEPLOY_DB_PATH=/data/ninedeploy.db

EXPOSE 3000
VOLUME /data

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/server.js"]
