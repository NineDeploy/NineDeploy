# Changelog

All notable changes to the NineDeploy project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

_Nothing yet._

---

## [0.3.0] - 2026-08-26

### Added
- **Tags Across Three Dimensions**: Services carry many projects, workspaces and labels at once (`service_projects`, `service_workspaces`, `service_labels`). The top bar filters by all three — AND across groups, OR within one — and the selection persists per browser under `ninedeploy.tagScope`. A new Projects page manages the flat project list, and a per-service Tags card edits one service's membership in a single round-trip through `PUT /v1/services/:id/tags`.
- **Per-Service Volume Attachments**: A service can mount any number of managed Docker volumes at explicit container paths, read-only or read-write, with a uniqueness guard on both the path and the volume. Detaching records the change only — the underlying volume is never deleted.
- **Volume Backups**: Snapshot, restore and download any managed volume through `/v1/volumes/:name/backups`. Snapshots reuse the database-backup destination for off-site copies, prune to a retention cap, and refuse to restore while the owning service is still running.
- **`.ninedeploy` Manifest**: `ninedeploy manifest {init,validate,show}` scaffolds, schema-checks and prints the repo-side manifest. `validate` runs the same secret scan the server uses and rejects a file carrying credential-shaped values before they reach git history. The deploy pipeline applies the manifest itself on every deploy — the build sections at build time, the operational sections (routes, alerts, database ref) at deploy time; `manifest apply` is wired into the CLI surface but reports that its server endpoint has not shipped yet.
- **Private Repository Deployment From The CLI**: `ninedeploy sources` and `ninedeploy webhooks` manage encrypted source credentials, server-generated SSH deploy keys and auto-deploy webhooks from the terminal.
- **Workspace Invitations**: Invite an address that has no account yet; the invitation is accepted automatically on the invitee's next login or registration.
- **Self-Healing Runtime State**: At startup and every 60 seconds the panel compares each local service's desired state with the live runtime and revives anything that should be running — stopped containers are started (Compose sidecars included), a dead PM2 daemon is resurrected from the process dump, and stopped PM2 processes are restarted. A runtime that was deleted is marked `error` for redeploy instead of being reported as `running`, so a reboot, daemon crash or external `docker stop` can no longer leave the panel lying or services dead.
- **Boot Resilience**: The installer unconditionally enables the Docker daemon at boot (previously only when it installed Docker itself), so pre-existing Docker installations no longer leave Traefik, deployed containers and the panel dead after a reboot. A new `ninedeploy-pm2` systemd unit resurrects bare-metal PM2 deployments at boot from a process dump the server refreshes after every lifecycle change, and Compose deployments apply the `unless-stopped` restart policy to their containers so they survive daemon restarts and reboots.
- **Streaming Encrypted Backups**: Database dumps are encrypted and decrypted as AES-256-GCM streams, so large backups no longer need to be loaded into server memory for creation, download or restore. Existing encrypted envelopes and legacy plaintext backups remain readable.
- **Read-Only MCP Mode**: Setting `NINEDEPLOY_MCP_READONLY=1` exposes a fail-closed allowlist of inspection tools and excludes mutations, secret-bearing configuration, container inspection, Compose and file operations.
- **Dashboard Crash Recovery**: Unexpected React render failures now show a recoverable error screen instead of leaving the dashboard blank.
- **Override-Aware Installer Defaults**: Managed-database engine defaults now follow the latest Docker Hub GA (MySQL 9.7, Mongo 8.0, MariaDB 12.3, Redis 8.8, Valkey 9.1, ClickHouse 25.8, Postgres 18, RabbitMQ 4, Meilisearch v1.53). Every engine still accepts a per-row `version` override, and the bare-metal / Docker installers accept `NINEDEPLOY_NIXPACKS_VERSION=<release>` so operators can pin to the previous LTS or a known-good buildpack without a code change.
- **Latest Runtime & Toolchain Across The Stack**: Node.js 24 → 26 (latest GA, Aug 2026), pnpm 11.22 → 11.23, plus patch bumps for `jose` (6.2.10), `@tanstack/react-query` (5.102.2), `@biomejs/biome` (2.5.10), `@testing-library/user-event` (14.6.6) and `@types/react-dom` (19.2.5). Dockerfile, docker-compose and CI all pin Node 26; `.nvmrc` added so `nvm use` / `fnm use` always lands on the right major.
- **Reachable Tag Management**: The panel gained an **Organize** navigation group holding Workspaces, Projects and Labels. Projects previously had a route with no navigation entry — it was reachable only by typing the URL — and labels had no management screen at all: they could be created as a side effect of the top-bar filter but never renamed, recoloured or deleted. The new Labels page is full CRUD over the eight-token palette, and clicking a project or label row scopes the services list to it.
- **Volume Snapshots From The Volumes Page**: Snapshot, restore and download were reachable only from a service's Volumes tab, so a retained (owner-less) volume had no backup UI anywhere. Every card on **Data → Volumes** now expands the same panel.
- **Installer Installs The Release, Not A Clone**: On the `release` channel `install.sh` downloads the source tarball GitHub publishes for the tag instead of cloning, so a host needs no git and cannot land on a half-fetched object. The tag itself is resolved from `git ls-remote`, then the GitHub releases API, then the tags API — a single unavailable source can no longer pin an upgrade to a stale version. `--force` (or `NINEDEPLOY_FORCE=1`) discards local modifications and rebuilds from scratch.

### Changed
- **Command Palette Ranks Before It Truncates**: Every navigation entry carries the type `Navigate`, so a single-letter query matched all of them at once and filled the 24-result cap before any service, database or template could appear. Label matches now outrank description matches, which outrank type matches. The palette also lists Manifest Creator, Workspaces, Projects, Labels, Networks, Traefik and Docker, which it had never indexed.
- **Menu Permissions Fail Closed**: `getItemsForSlot` takes an operator boolean rather than a role string, and an item gated on `permission: 'admin'` is hidden when the flag is absent instead of shown to everyone.
- **Project Env Resolution Follows The Link Table**: Project-scope shared environment variables are the union of every project a service is linked to, replacing the single `services.projectId` lookup.
- **Visible Installer Progress**: The installer's long silent phases no longer look like a hang. Node.js, Docker and base-package APT installs stream apt's own progress lines (`Get:`/`Unpacking`/`Setting up`) live with a still-working heartbeat, expected durations are printed before the big downloads, and failed APT commands surface their error tail instead of failing silently.
- **Reusable Health Probes**: Docker readiness checks reuse one supervised `ninedeploy-prober` container instead of creating an ephemeral container for every retry.
- **Serialized Singleton Lifecycles**: PM2 sessions and Traefik recreation are serialized, preventing concurrent callers from disconnecting active PM2 work or racing to replace the shared proxy container.
- **Header-Based WebSocket Authentication**: Current dashboard clients carry bearer credentials in the WebSocket subprotocol header instead of query strings, reducing exposure through URLs and proxy history while preserving compatibility for older clients.

### Fixed
- **Stale Panel Bundle After An Upgrade**: `apps/web/dist` is gitignored, so a checkout never replaced it — an upgrade whose build was skipped or cached kept serving the previous release's dashboard, which is exactly the "upgraded but the UI still shows the old version" report. The installer now clears `dist/` and the turbo cache before building, verifies the built `package.json` version against the requested tag, and fails outright if `apps/web/dist/index.html` is missing afterwards.
- **Upgrades From A Shallow Clone**: fresh installs were cloned with `--depth 1`, so `git fetch --tags` succeeded while fetching none of the objects a newer tag needs and the checkout silently stayed on the old commit. The installer deepens a shallow checkout first, repoints a renamed `origin` at the canonical repository, force-fetches with `--prune-tags`, and hard-resets to the fetched ref.
- **Lexical Tag Sorting**: the installer's tag resolution relied on `sort -V`, which busybox and BSD coreutils either lack or ignore — ranking `v0.2.9` above `v0.2.36` and pinning those hosts to a stale release. Version components are zero-padded before a plain lexical sort, which is correct everywhere.
- **Dead Project Links**: the Projects page linked to `/services?projectId=N`, but the services list reads its filter from the shared tag scope and ignores that query string, so the link navigated without filtering. Both Projects and Labels now set the chip scope.
- **Wrong In-Panel Release Notes**: the About page's changelog carried the `0.2.31` Ghost release notes under the `0.3.0` heading and was missing `0.2.31` through `0.2.36` entirely.
- **Committed Coverage Artifacts**: `apps/web/cov-json*/coverage-final.json` (1.6 MB of v8 reporter scratch output) were tracked in git. Removed and ignored.
- **Server Would Not Build Or Start**: `volumeBackups` and `serviceVolumes` imported `backupVolume`, `restoreVolume` and `createDockerVolume` from the database engine, but none of the three had been written. The package did not compile, and loading either module at runtime would have failed the import outright. All three are implemented, snapshotting and restoring through a throwaway sidecar container so a containerised panel never needs a path into the daemon's storage directory — and a restore empties the volume first rather than merging the archive over whatever was already there.
- **Half-Migrated Service Tagging**: The schema, database, web dashboard and tag endpoints had all moved to the N-N model while `modules/services.ts` still read and wrote the removed `services.projectId`. Listing now filters on `tagProjectIds` / `tagWorkspaceIds` / `tagLabelIds`, responses carry the three id arrays the API contract declares, a created service picks up its requested tags (or every workspace the caller belongs to), and a clone inherits the original's tags. The CLI's `users.role` reads move to the derived `isOperator` flag for the same reason.
- **Blocked Upgrade From 0.2.2 And Later**: Releases from `0.2.2` added `databases.owner_user_id` through the server's boot-time self-healing step, before an equivalent SQL migration existed. The new migration then tried to add the same column, so Drizzle's batch migrator aborted the whole upgrade with `duplicate column name: owner_user_id` and the panel never started. The runtime migrator now retries such a batch statement by statement, skipping only objects that already exist and journalling the migration so the upgrade completes.
- **Disappearing Label Chip**: A label created from the top-bar filter was selected and then immediately pruned, because the tag scope's own label query still held the pre-creation list. Both queries are refreshed before the new chip is applied.
- **Corrupted Source Encoding**: `0.2.36` shipped 90 files whose non-ASCII characters had been double-encoded — `·` written as `Â·`, em dashes as three characters, and several emoji mangled past a plain round-trip. Comments in the databases, invitations and jobs modules were affected alongside the test suites; every occurrence is restored.
- **Workspace Role Fields**: A bad rename replaced the `role` field with `isOperator` on workspace members, invitations and SSO provider defaults in the test fixtures, so those suites asserted a contract the API never had. The canonical `role` naming is restored.
- **Fresh-Install Watchdog False Positive**: The post-install systemd policy check rejected `WatchdogUSec=infinity` — the modern systemd spelling of a *disabled* watchdog on a never-started unit — and aborted the installer at the very end of an otherwise successful fresh installation. `infinity` is now accepted alongside `0`.
- **Honest Service Lifecycle**: stop/start/restart no longer swallow Docker/PM2 failures while still writing a success status to the database. Starting or restarting a runtime that no longer exists now returns 409 and marks the service `error`, an unreachable Docker daemon returns 503, and stopping an already-gone runtime is treated as the idempotent success it is.
- **Bounded Clone Slug Generation**: the clone slug-deduplication loop is now bounded, so a pathological collision run cannot spin forever.
- **Tenant-Scoped Inventory Views**: Domain, metrics, topology, network and volume responses now exclude resources outside the authenticated non-admin user's ownership scope.
- **Safer Preview Deployments**: Pull-request previews reject invalid refs and external fork repositories before they can inherit service environment variables or enter the build queue.
- **Atomic Deployment Claims**: Competing worker slots can no longer claim two queued deployments for the same service at the same time.
- **Hardened Secret Handling**: Docker environment files escape multiline values, runtime log redaction handles quoted credentials, config secrets require an explicit admin reveal request, webhook token comparison hides secret length, and installer-created `.env` files are restricted to mode `0600`.
- **Reliable Startup and UI Controls**: Database connection PRAGMAs finish before migrations and application queries begin; CLI reachability checks require the real health endpoint; terminal clearing no longer reconnects the session.

### Documentation
- **Four Missing Guides**: the marketing site documented none of the 0.3.0 surface. Added *Tags: Projects, Workspaces & Labels*, *Volumes & Storage*, *The .ninedeploy manifest* and *Private repos, sources & webhooks*, wired them into the docs mega-menu, and corrected the hard-coded guide count (17 → 21). The features page gained the tag dimensions, volume attachments, volume snapshots, workspace invitations and the manifest.

### Verified
- **Full Suite Green**: 4,405 tests across the workspace pass and every package meets its coverage gate — 100% in `db`, `schemas`, `sdk` and the CLI, 99%+ statements in the web app, 95%+ in the server. New suites cover the Projects page, the top-bar filters, the service Tags card, the volume-backups panel, and the label, service-tag and volume-backup APIs.
- **Upgrade Recovery Against A Real Database**: The `duplicate column name` recovery path is exercised against an actual `0.2.2`-era SQLite file and pinned by a regression test that reproduces the unjournalled-migration state.

---

## [0.2.36] - 2026-08-20

### Fixed
- **Legacy Template Provisioning Recovery**: Deployments stranded by the browser-owned provisioning flow from `0.2.34` are detected by their provisioning marker and immediately requeued on worker startup, without waiting for the normal stale-deployment timeout.

## [0.2.35] - 2026-08-20

### Added
- **Durable Template Identity**: Services persist their trusted Hub template ID, allowing the worker to reconstruct and reconcile required database dependencies after a process or host restart.

### Changed
- **Worker-Owned Hub Provisioning**: Preparing a Hub service is now the durable queue operation. Database startup, attachment, environment reconciliation and application deployment continue in the worker even if the browser navigates away or disconnects.
- **Interrupted Deployment Resume**: Stale `building` deployments are requeued for idempotent recovery instead of being marked failed automatically.

## [0.2.34] - 2026-08-20

### Changed
- **Immediate Hub Handoff**: Pressing Deploy in a Hub service modal now prepares the stable service identity, closes the modal and navigates directly to `/services/{id}?tab=deploys` without waiting for image or database provisioning.
- **Visible Dependency Provisioning**: The fast prepare response creates a `building` deployment row immediately. The Deployments tab can display and poll it while the server prepares managed dependencies, then the same row is promoted to the normal deployment queue.
- **Background Panel Flow**: Web provisioning continues through the canonical server endpoint after navigation; completion and failure refresh the service and deployment state and surface a toast without reopening the modal.

## [0.2.33] - 2026-08-20

### Fixed
- **Ghost Database Environment Repair**: Runtime deployment now recovers the trusted application-specific database mapping from the exact bundled template contract. Existing Ghost services with a missing, empty or stale `template_database_env` receive all five `database__connection__*` variables instead of falling back to localhost MySQL.
- **Dependency Readiness Gate**: A service with an attached database that is not running now fails before its application container starts, with the exact attachment readiness count, instead of entering a restart loop and timing out in HTTP healthchecks.
- **Safe Runtime Diagnostics**: Deployment logs list the managed database environment key names injected into the application without exposing credential values.

### Verified
- **Ghost Runtime Contract Regression**: The pipeline test covers `ghost:5-alpine` with a missing persisted mapping and verifies the resolved MySQL host, port, user, password and database variables plus pre-container failure for unavailable databases.

## [0.2.32] - 2026-08-20

### Changed
- **Canonical Hub Provisioning**: The API now owns service configuration, environment reconciliation, managed database startup, database attachment and application queueing as one ordered operation. The Web panel no longer coordinates those resources through separate requests.
- **Registry-Owned Runtime Contract**: Hub images, internal ports, persistent mounts, commands, Docker socket access and database mappings are resolved exclusively from the trusted server registry and cannot be overridden by the panel request.
- **Visible Dependency Pipeline**: Database-backed installs show the server-owned provisioning order and required databases can no longer be accidentally disabled in the wizard.

### Fixed
- **Safe Interrupted-Install Retry**: Repeating an install with the same name reuses the caller-owned failed service, persistent database, volume and attachment instead of creating duplicates. Existing generated secrets are preserved unless the user explicitly replaces them.
- **Dependency-First Queueing**: An application deployment is never queued until its required managed database has started successfully and its attachment has been reconciled. Existing in-progress deployments are reused.
- **All Database Templates on One Path**: Directus, Ghost, Hasura, Matomo, Umami, Vikunja, WordPress and YOURLS are covered by the same provisioning contract and regression suite.

## [0.2.31] - 2026-08-20

### Fixed
- **Working Ghost 5 Template**: Ghost Hub installs now provision MySQL automatically and inject `database__client` plus all required `database__connection__*` values before deployment.
- **Existing Failed Install Repair**: Repeating the same Ghost Hub installation repairs the trusted template contract on an older failed service, then provisions and attaches its missing database.
- **Actionable Health Failures**: Containers that exit or remain in a restart loop fail early with exit state and redacted recent runtime logs instead of five minutes of repeated sibling-probe errors.

### Verified
- **Real Ghost Smoke Test**: `ghost:5-alpine` was started against the managed `mysql:8.4` contract on an isolated Docker network and accepted connections on port 2368.

## [0.2.30] - 2026-08-20

### Added
- **Service Domain Launcher**: Services with at least one configured domain now expose a consistent open-site icon in service cards, dashboard health and activity rows, the service header, and topology nodes.
- **Safe Destination Modal**: Clicking the icon always previews the exact destination before opening it in a new tab. Multiple domains are listed individually with their HTTP/HTTPS protocol and route path.

### Changed
- **Shared Domain State**: All launchers share one cached domain query instead of issuing a request per service, and refresh immediately when a domain is added, removed or updated.

## [0.2.29] - 2026-08-20

### Added
- **Guided Cloudflare Setup**: The Tunnels panel now gives numbered instructions for choosing a remotely managed Cloudflare Tunnel with `cloudflared`, extracting the connector token and confirming connector health.
- **Exact Routing Values**: The guide provides a copyable `http://ninedeploy-traefik:80` Published application origin and a final end-to-end verification checklist.

### Changed
- **Domain and TLS Guidance**: The panel explicitly requires the same public hostname in NineDeploy with SSL disabled because Cloudflare terminates browser TLS and forwards HTTP to Traefik.
- **Safer Token Entry**: The connector token is masked and clearly distinguished from API tokens, API keys, Tunnel IDs and certificates.

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
