# Changelog

All notable changes to the NineDeploy project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.28] - 2026-08-20

### Added
- **Full Curated Catalog**: All 88 schema-valid, single-service-compatible templates are visible and deployable in the Hub again.
- **Trust Tiers**: The Hub shows `All 88`, `Verified 15` and `Community 73` filters, plus a clear trust badge on every application card.

### Changed
- **Transparent Certification**: Runtime smoke certification is communicated as metadata instead of being used as a blanket visibility filter. Community templates display a review warning before configuration and deployment.

## [0.2.27] - 2026-08-20

### Added
- **Container Port Control**: Service Network settings expose the internal application port used by Traefik, healthchecks and optional host-port publishing.
- **Image Port Detection**: Dockerfile and image deployments automatically adopt an unambiguous single TCP port from image `EXPOSE` metadata.

### Fixed
- **Nixpacks Domain Routing**: Dockerfile-less source deployments now default to port 3000, receive `PORT=3000`, persist the resolved port and generate a usable Traefik upstream after the first successful deployment.
- **Single Routing Port**: Process configuration, readiness checks, Docker port mapping and Traefik no longer derive their target ports independently.

## [0.2.26] - 2026-08-20

### Fixed
- **Real Nixpacks CLI**: Source deployments use the actual Nixpacks 1.37.0 executable instead of trying to run the CLI command inside `ghcr.io/railwayapp/nixpacks`, which is a build-base image and contains no `nixpacks` command.
- **Consistent Host and Agent Builds**: The Ubuntu installer and NineDeploy runtime image provision the same pinned CLI for local and remote deployments.

### Security
- **Verified Build Toolchain**: AMD64 and ARM64 Nixpacks release archives are downloaded from the official release and checked against architecture-specific SHA-256 digests before installation.

## [0.2.25] - 2026-08-20

### Added
- **Deployment Activity Heartbeats**: Any deployment command that remains silent for 20 seconds emits an elapsed-time liveness message, while fresh stdout or stderr postpones the heartbeat to keep normal logs clean.
- **Recovery Phase Visibility**: Direct registry export, recovered-filesystem packaging, and Docker image import report their exact phase every 15 seconds without inventing percentages that upstream tools do not provide.

### Security
- **Safe Progress Labels**: Generic heartbeat messages never include subprocess arguments, preventing passwords, tokens, and other sensitive command values from leaking into deployment logs.

## [0.2.24] - 2026-08-20

### Fixed
- **Explicit Native Platform**: Native snapshot recovery now passes the host `linux/amd64` or `linux/arm64` platform to both containerd pull and mount operations, so multi-platform OCI indexes resolve deterministically.
- **Containerd 2 Transfer Workaround**: `no unpack platforms defined` failures from containerd's transfer API automatically retry through `ctr --local`, the upstream-documented workaround, before using direct registry export.

## [0.2.23] - 2026-08-20

### Fixed
- **Image-Independent Recovery**: Snapshotter-independent recovery is certified across Docker Hub, GHCR, and Codeberg images instead of being treated as a MySQL-specific path.
- **BusyBox Export Compatibility**: The pinned, checksum-verified registry client release also handles root filesystem archives containing a top-level `.` entry, which is required by BusyBox and can occur in arbitrary service images.
- **Shared Verified Tooling**: Concurrent and sequential image recoveries reuse one verified registry binary per NineDeploy process instead of downloading it once per application or database.

### Added
- **Hub-Wide Recovery Gate**: `pnpm docker:smoke-registry-recovery` forces all 15 runtime-certified Hub applications through direct registry export, fresh Docker import, real container startup, and declared TCP-port probing. WordPress/MySQL and Directus/PostgreSQL additionally prove database initialization and application wiring.

## [0.2.22] - 2026-08-20

### Fixed
- **Snapshotter-Independent Image Recovery**: When both Docker overlayfs extraction and containerd's native snapshotter fail, NineDeploy now exports the image filesystem directly from its OCI registry and imports it under a fresh single-layer chain ID.
- **Verified Recovery Tooling**: The emergency registry client is pinned to an exact upstream release and its Linux amd64/arm64 archive is checked against a built-in SHA-256 before execution.
- **Runtime Metadata Preservation**: Direct recovery retains environment, entrypoint, command, working directory, user, stop signal, exposed ports, volumes, labels, on-build instructions, and healthcheck configuration.

### Added
- **Real MySQL Recovery Smoke**: `pnpm docker:smoke-registry-recovery` exports `mysql:8.4` without a containerd snapshotter, imports it under an isolated test tag, starts it, waits for `mysqladmin ping`, and removes only its exact smoke resources.

## [0.2.21] - 2026-08-20

### Fixed
- **Fail-Closed Template Hub**: Registry-valid templates are no longer automatically advertised as deployable. Hub list, detail, Web deploy, CLI deploy, and direct service creation accept only runtime-certified templates.
- **Runtime-Certified Initial Set**: n8n, WordPress, Directus, Gitea, Forgejo, Uptime Kuma, Vaultwarden, Memos, Kavita, PocketBase, Qdrant, Actual Budget, MinIO, Grafana, and Excalidraw passed isolated container startup and declared-port probes.
- **No Marketing Inflation**: Public surfaces now distinguish the 15 runtime-certified templates from the larger registry-inspected catalog.

### Added
- **Reusable Runtime Smoke Runner**: `pnpm templates:smoke-runtime -- --ids=...` pulls each selected image, starts it with its real registry environment, command and persistent volume, verifies that it remains running and listens on the declared Docker-network port, then removes only its isolated test resources.

## [0.2.20] - 2026-08-20

### Fixed
- **Honest One-Click Catalog**: Removed 47 stack components and unsupported containers that cannot run under NineDeploy's current single-application plus optional single-database contract. The remaining 88 images all pass live OCI registry inspection.
- **Real Database Template Wiring**: Templates persist application-specific connection mappings, so WordPress receives `WORDPRESS_DB_*`, Directus receives `DB_*`, and other supported database apps receive the fields their images actually consume instead of an unusable generic URL.
- **Working MySQL Initialization**: Managed MySQL and MariaDB instances create and persist the `app` database during first boot; connection strings now target that real database.
- **CLI Database Provisioning**: `ninedeploy templates deploy` now provisions, starts, records, and attaches the required managed database before queuing the application deployment.
- **Trusted Template Runtime Settings**: Web Hub deploys send only a template ID; server-side registry data supplies protected commands, Docker socket access, and database mappings so MinIO and Docker-management templates no longer lose required runtime settings.
- **Corrected Upstream Images**: Memos uses `neosmemo/memos:stable`, Forgejo uses the supported v16 image, and Kavita uses `jvmilazz0/kavita:latest`.
- **Independent Template Data**: Multiple installations of the same database-backed template derive database names from the actual service slug and no longer share one database accidentally.

### Added
- **Live Image Contract Gate**: `pnpm templates:verify-images` checks every bundled template against its OCI registry and exits non-zero for missing repositories or tags.

## [0.2.19] - 2026-08-20

### Fixed
- **No Hidden Docker Pulls**: BusyBox health probes, Alpine volume tools, Adminer/Redis Commander, Nixpacks, Cloudflare Tunnel, dashboard netns probes, and Traefik now prepare their images through the same bounded containerd recovery used by deployments and databases.
- **Remote Agent Recovery Parity**: `docker.pull` operations executed by remote NineDeploy agents now use the shared snapshot repair and native-snapshot fallback instead of a raw Docker CLI pull.
- **Canonical Traefik Lifecycle**: Startup, watchdog healing, and manual updates use one container configuration path, preserving ACME/DNS settings, config fingerprints, host gateway routing, network attachment, and post-start liveness checks.
- **Working Automatic HTTPS**: Wildcard domains created after deployment are marked SSL-enabled when an ACME email is configured, allowing Traefik to request and renew certificates automatically.
- **Reliable Ubuntu Privileges**: The installer uses one elevated Docker wrapper when group membership is not active yet, detects external versus daemon-managed containerd storage, and runs the Docker host control-plane as root instead of a nominally unprivileged but Docker-root-equivalent user.
- **Real Install Readiness**: Installation now fails unless Traefik is running, attached to the shared network, and actually answering on port 80.

## [0.2.18] - 2026-08-20

### Fixed
- **Targeted Stale Snapshot Repair**: Persistent Docker 29 `target snapshot already exists` failures now validate the exact overlayfs snapshot as committed, ask containerd to remove it only when it has no active dependants, and retry the original pull before using the flattened-image fallback.
- **Correct containerd Endpoint Detection**: Recovery commands now explicitly target Docker's external or daemon-managed containerd socket instead of assuming the `ctr` default.
- **Actionable Recovery Errors**: If both targeted repair and native recovery fail, the deployment error now includes the native recovery failure instead of reporting only the original `docker pull` exit code.

## [0.2.17] - 2026-08-20

### Fixed
- **Managed Database Image Recovery**: PostgreSQL, MySQL, MariaDB, Redis, Valkey, and MongoDB images are now explicitly prepared through NineDeploy's Docker 29/containerd snapshot recovery before `docker run`.
- **No Implicit Database Pulls**: Database startup no longer delegates image pulling to `docker run`, preventing stale overlayfs metadata from surfacing only as an opaque exit code 125. Failed image preparation stops before container state or secret env files are mutated.

## [0.2.16] - 2026-08-20

### Fixed
- **Panel-Wide Autofill Rejection**: Authenticated panel inputs and textareas now disable browser autocomplete, autocorrect, spellcheck, and the autofill hooks used by common password managers, including fields mounted later by dialogs and plugins.
- **Settings Navigation Protection**: The Settings filter remains read-only until deliberate pointer or keyboard interaction and actively rejects Chrome/Safari autofill injection, preventing stray values such as `k` from hiding the settings menu.

## [0.2.15] - 2026-08-20

### Fixed
- **Persistent Docker 29 Snapshot Recovery**: A pull blocked by a stale containerd overlayfs target now switches immediately to the isolated native snapshotter, reconstructs a verified single-layer image, and continues the deployment.
- **Non-Destructive Recovery**: The fallback preserves the image runtime configuration and filesystem ownership, capabilities, ACLs, and extended attributes without deleting or hiding existing images, containers, or volumes.

## [0.2.14] - 2026-08-20

### Fixed
- **End-to-End Hub Retry Recovery**: Interrupted template deployments now resume only their matching caller-owned idle service, overwrite the partial template environment safely, reuse the matching database, and reuse an existing service/database attachment.
- **No More Partial-Install Collisions**: Retrying after a database startup anomaly no longer stops at service slug, environment key, database slug/container, or attachment uniqueness errors.

## [0.2.13] - 2026-08-20

### Fixed
- **Database Start Reconciliation**: A managed database container that is actually running is now adopted when `docker run` reports a late code 125 failure, preventing a false `error` state.
- **Retryable Hub Database Provisioning**: Hub templates can safely resume their own matching database after an interrupted attempt instead of failing on the existing slug/container name. Ownership, engine, project, and version must all match.

## [0.2.12] - 2026-08-20

### Fixed
- **Automatic Image Port Recovery**: When a Docker healthcheck fails on the configured internal port, NineDeploy now reads the container image's declared TCP ports, probes those alternatives from the shared Docker network, and adopts the first healthy port.
- **Persistent Routing Repair**: The detected port is persisted on the service before Traefik routing is regenerated, so subsequent deploys and domain requests use the corrected value. This repairs n8n deployments mistakenly configured for port `80` by switching them to the image-declared `5678/tcp` port.

## [0.2.11] - 2026-08-20

### Fixed
- **Live Let's Encrypt Activation**: Saving the ACME account email in Settings -> Security now safely recreates Traefik, mounts writable persistent `acme.json`, regenerates routers with the `letsencrypt` resolver, and starts certificate issuance immediately.
- **Live DNS-01 Updates**: DNS provider, API token, and wildcard apex changes now recreate Traefik and regenerate its dynamic configuration without waiting for a NineDeploy restart.
- **Stale Static Configuration Detection**: Managed Traefik containers carry a SHA-256 fingerprint of their static ACME and DNS inputs. A missing or outdated fingerprint forces a safe recreate, including after an interrupted prior update.
- **Installer ACME Setup**: Interactive installs now ask for the required Let's Encrypt account email and persist it in `.env`; unattended installs clearly warn when automatic HTTPS remains disabled.

## [0.2.5] - 2026-08-19

### Fixed
- **Fail-Closed Traefik Bootstrap**: Docker network creation, Traefik image pulls, container startup and network attachment are now mandatory verified installation gates; NineDeploy no longer reports a healthy install while domain routing is unavailable.
- **Idempotent Traefik Provisioning**: Re-running the installer now reuses a locally verified Traefik v3 image. When no usable image exists it attempts Docker Hub exactly once, then immediately checksum-verifies the official Traefik release binary and constructs a minimal image without the conflicting Alpine layer; the installer no longer loops pulls, prunes images, restarts Docker, or edits containerd metadata.
- **Missing Containerd Snapshot Root Repair**: Docker 29 hosts whose overlayfs metadata remains but physical `snapshots/` directory was lost are repaired by recreating only that required root directory with strict root ownership and permissions; existing metadata and container data are never removed.
- **Traefik Status Detection**: Container liveness now comes exclusively from Docker state and no longer flips to `stopped` when optional version probing fails; both the official PATH binary and the layer-free `/traefik` binary are supported.
- **Permanent systemd Watchdog Migration**: The installer now installs and verifies an explicit `Type=simple` / `WatchdogSec=0` runtime policy, repairing stale `Type=notify` installations that could SIGTERM long Docker pulls with exit code 143.
- **Absolute Data Directory Rendering**: Relative `.env` values such as `NINEDEPLOY_DATA_DIR=./.data` are resolved against the installation directory before being written to systemd `ReadWritePaths`.
- **Drop-in Ordering Safety**: The installer-owned watchdog safety policy sorts after conventional `override.conf` files and replaces the short-lived numeric-prefix migration file without deleting administrator configuration.
- **Removed Invalid Runtime Notify Client**: Removed the dependency-free stream-socket `sd_notify` implementation and its watchdog calls; installer HTTP health checks remain the authoritative readiness gate.
- **Installer Argument Parsing**: Correctly parses both spaced and equals forms of `--version` and `--channel`, with validation for unsupported values.
- **Accurate Docker Exit Diagnostics**: Documentation now distinguishes SIGTERM exit 143 from the usual OOM/SIGKILL exit 137.

## [0.2.4] - 2026-08-19

### Added
- **Full Host Firewall (UFW) Management Engine**: Interactive host firewall control across API (`/v1/firewall`), SDK, Web UI (`Settings -> Firewall`), and CLI (`ninedeploy firewall`).
- **1-Click Service Port Presets in Web UI**: Single-click activation/deactivation for common multi-port services including Mail Server (Poste.io / Mailcow: `25, 465, 587, 993, 995`), Databases (PostgreSQL `5432`, MySQL `3306`, Redis `6379`, MongoDB `27017`), Web Ingress (`80, 443`), and SSH (`22`).
- **Automatic Installer Firewall Hardening**: `install.sh` automatically configures and hardens UFW rules for SSH (`22/tcp`), Web (`80/tcp`, `443/tcp`), and custom panel ports without accidental lockout risk.
- **Node.js 24 & 22 Active LTS Support**: Updated installer and package engines to prioritize Node.js 24 LTS and Node.js 22 LTS on Ubuntu 24.04/26.04 and Debian 12.

### Fixed
- **Ubuntu 24.04 Systemd Socket & Symlink Compatibility**: Hardened systemd unit file `ReadWritePaths` with non-fatal prefixes (`- /var/run/docker.sock`, `- /run/docker.sock`) to prevent mount failures on modern systemd distributions.
- **Background Timer Unreferencing**: Added `unref: true` to worker, metrics collector, and cron scheduler intervals to prevent process retention and optimize event loop lifecycle.

---

## [0.2.3] - 2026-08-19

### Added
- **Monorepo Version Synchronization (`pnpm version:bump`)**: Automated version bumper script synchronizing root, all 9 packages, and in-code API/CLI/MCP constants in a single step.
- **Traefik Background Self-Healing Watchdog**: Periodic watchdog reviving stopped or pruned proxy containers automatically.
- **Automated Memory & Swap Provisioning**: `install.sh` automatically detects low-memory VPS hosts ($\le 4\text{GB}$ RAM) and allocates an active 2GB `/swapfile` to prevent OOM kills on heavy image pulls.
- **Enhanced Doctor & Self-Healing Engine**: `ninedeploy doctor --fix` with comprehensive RAM, Swap, Docker storage layer, SQLite integrity, network latency diagnostics, and automated repair.
- **Zero-Failure Ubuntu Server Hardening**: Automatic installation of essential base utilities (`curl`, `git`, `ca-certificates`, `tar`), pre-creation of the `ninedeploy` Docker network, pre-pulling of `traefik:3`, and conflict resolution for ports 80/443 (auto-disabling competing `apache2`/`nginx` services).

### Fixed
- **ACME Permissions Enforcement**: Ensured strict `0600` permissions on `/etc/traefik/acme.json` before container mount.
- **Systemd Watchdog Timeout Termination**: Switched systemd unit to `Type=simple` and removed 90s watchdog timer to eliminate false-positive SIGTERM kills (exit code 143) during long builds and large image pulls (e.g. `n8nio/n8n`).
- **Database Migrator Directory Creation**: `packages/db` automatically ensures parent directories exist recursively to prevent SQLite Error 14 (`SQLITE_CANTOPEN`).
- **Cross-Platform MCP URL Resolution**: Replaced manual string concatenation in `@ninedeploy/mcp` with `node:url` `pathToFileURL` to normalize file URL comparisons across Windows drive letters and Linux paths.
- **Installer Script Health Loop**: Fixed Bash special loop variable shadowing (`$_` in `seq` loop) during `/health` readiness polling in `install.sh`.
- **First-Run Admin Bootstrap**: Hardened transactional setup and error handling for initial instance registration and database reset workflows.

### Verified
- **Monorepo Test Suite**: Verified 100% test pass rate across 2,100+ tests and 100% branch/statement coverage in all 9 packages.
- **Zero-Error Pipeline**: Complete workspace verification across Biome linter, TypeScript strict typecheck, and production builds.

---

## [0.2.2] - 2026-08-19

### Fixed
- **Cross-Platform MCP URL Resolution**: Replaced manual string concatenation in `@ninedeploy/mcp` with `node:url` `pathToFileURL` to normalize file URL comparisons across Windows drive letters and Linux paths.
- **Installer Script Health Loop**: Fixed Bash special loop variable shadowing (`$_` in `seq` loop) during `/health` readiness polling in `install.sh`.
- **First-Run Admin Bootstrap**: Hardened transactional setup and error handling for initial instance registration and database reset workflows.

### Verified
- **Monorepo Test Suite**: Verified 100% test pass rate across 2,100+ tests and 100% branch/statement coverage in all 9 packages.
- **Zero-Error Pipeline**: Complete workspace verification across Biome linter, TypeScript strict typecheck, and production builds.

---

## [0.2.1] - 2026-08-18

### Added
- **NPM Distribution**: Official npm publication configuration for CLI and public SDK packages.
- **CLI Package Naming**: Renamed CLI package to `ninedeploy` for instant `npx ninedeploy` execution and global npm install.
- **Public Monorepo Packaging**: Configured public access rules for `@ninedeploy/sdk`, `@ninedeploy/schemas`, `@ninedeploy/plugin-sdk`, and `@ninedeploy/mcp`.
- **Release Automation**: Streamlined workspace release scripts and multi-package dependency publishing workflows.

---

## [0.2.0] - 2026-08-18

### Added
- **Workspaces & Multi-Tenancy**: Workspace isolation with 4-tier RBAC (`Owner`, `Admin`, `Member`, `Viewer`).
- **Enterprise SSO & Passkeys**: OpenID Connect (Google, GitHub, Keycloak, Okta), biometric Passkeys (WebAuthn / FIDO2), and TOTP 2FA.
- **Microkernel Architecture**: Event bus and waterfall hook pipeline (`deploy.before`, `deploy.after`).
- **Configuration Center**: Dual-Vault AES-256-GCM encryption with automatic master key rotation.
- **Plugin SDK**: Modular plugins with `MenuRegistry` and `ServiceRegistry` driver interchange.
- **AI Model Context Protocol (MCP)**: 35-tool MCP server for AI coding assistants (Claude, Cursor, Antigravity, Cline).
- **Extended Databases**: 1-click Postgres (`pgvector`), MySQL, MariaDB, Redis, Valkey, ClickHouse, Meilisearch, Mongo, and RabbitMQ.
- **Container File Manager**: Live in-browser filesystem browser with drag-and-drop operations.
- **Log Drains**: Structured log forwarding to Syslog, HTTP endpoints, and Datadog.
- **Preview Environments**: Ephemeral PR staging environments with automatic cleanup on pull-request close.

---

## [0.1.0] - 2026-08-14

### Added
- **Core Deploy Engine**: Git repositories (public/private) + Docker image sources, PM2 + Docker targets.
- **Zero-Downtime Releases**: Blue-green deployment pipeline with health checks and automatic rollback.
- **Auto-Deploy Webhooks**: GitHub, GitLab, and Gitea integration with HMAC signatures.
- **Live Terminal & Logs**: WebSocket streaming logs and in-browser interactive xterm.js terminal.
- **Managed Databases & Backups**: Automated daily encrypted snapshots with S3-compatible offsite sync.
- **Traefik Ingress**: Automatic Let's Encrypt TLS (HTTP-01 & DNS-01) and Cloudflare Tunnels.
- **Hardened Service Model**: `systemd` watchdog supervision (`sd_notify`) and rootless container execution.
