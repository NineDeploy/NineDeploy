# Changelog

All notable changes to the NineDeploy project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
