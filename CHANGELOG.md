# Changelog

All notable changes to the NineDeploy project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
