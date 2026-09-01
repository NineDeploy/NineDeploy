const releases = [
  {
    version: "0.4.6",
    date: "2026-09-01",
    status: "current",
    notes: [
      {
        t: "Fixed — Lockfile Reflects the Dependency Patches",
        items: [
          "The drizzle-kit patch removes @esbuild-kit/esm-loader from its manifest and the archiver-utils patch moves glob to ^13 — but pnpm kept resolving those edges from the UNPATCHED manifests, so @esbuild-kit/core-utils, @esbuild-kit/esm-loader and the vulnerability-flagged glob@10.5.0 stayed in the lockfile and the installed store. Overrides now cut the edges at resolution level: 23 packages left the tree, and glob resolves into the maintained 13.x line fastify already carries",
          "The deprecated-dependency guard strips the lockfile's overrides: metadata block before grepping — the block legitimately names the packages being removed, so the guard keeps guarding without false-failing on its own fix",
        ],
      },
      {
        t: "Fixed — Deploy E2E Tests Verify Model B Networking",
        items: [
          "The deploy integration suite still assumed the runtime container sits on the shared ninedeploy mesh and fetched it by name from a mesh container — but every runtime lives on its own nd-svc-<slug> bridge since v0.3.0, where the mesh neither resolves the name nor routes to it. The pipeline itself passed on CI; the test's own verification failed with 'bad address'",
          "The suite now verifies reachability the way platform infrastructure (Traefik, the probe container) does — from a container attached to the service's bridge, by name — asserts bridge membership instead of mesh membership, and sweeps the bridge on teardown",
        ],
      },
    ],
  },
  {
    version: "0.4.5",
    date: "2026-09-01",
    status: "stable",
    notes: [
      {
        t: "Fixed — Healthcheck Probes Reach Per-Service Bridges",
        items: [
          "The v0.3.0 per-service bridge migration left the healthcheck's sibling probe stranded: ninedeploy-prober stayed on the shared ninedeploy mesh while every runtime moved to its own nd-svc-<slug> bridge, and Docker drops inter-bridge traffic by default. Any app that binds its port later than the 10-second direct-probe grace (first boot, DB migrations — Directus was the first app hit) burned the whole 5-minute healthcheck window on blind nc timeouts and failed deployment while perfectly healthy",
          "The prober now joins the runtime's networks idempotently before the sibling probe, mirroring how Traefik is permanently attached to every bridge; networks it already sits on are skipped. The first sibling failure logs the probe topology — which networks the container and prober actually sit on — instead of a bare nc exit code",
          "Container diagnostics no longer lose stderr: docker logs exits 0 and capture() returns stdout only, so a crashed boot's own explanation silently vanished from the 'Recent container logs' section — both streams are captured now",
        ],
      },
      {
        t: "Security Gates",
        items: [
          "Egress routes are operator-only via a preHandler role check — listing or mutating host-level SNAT/iptables state is not a project-member capability; the suite pins the 403 rejection before any driver method runs",
          "The CORS allowlist excludes localhost origins in production — the panel is same-origin in prod; localhost:5173/3000 remain allowlisted in dev only",
          "The workspace owner's membership role can no longer be changed in place (403): demoting the owner without transferring workspaces.ownerId could let an admin lock the owner out or leave an owner without owner access — ownership moves only through the transfer route",
          "The 256 MB request-body allowance is scoped to the backup import route instead of global, so login, webhooks and ordinary JSON endpoints cannot allocate a quarter-gigabyte Buffer before authentication runs",
          "Workspace projects require the workspace admin role to mutate — project rename/re-home/delete and shared env var edits now demand workspace admin; members keep discover-and-read access. Service cloning requires admin too, since it duplicates encrypted secrets and the full build definition into a caller-owned service",
        ],
      },
    ],
  },
  {
    version: "0.4.4",
    date: "2026-09-01",
    status: "stable",
    notes: [
      {
        t: "Fixed — Retained-Volume Adoption on Retry",
        items: [
          "The retained-volume fix now survives a retry. Adoption was gated on status = 'creating', but every failure path flips the row to error — so the most common follow-up (deploy again) skipped adoption entirely and booted the retained volume's stale credentials, re-creating the exact crash-loop 0.4.3 set out to close",
          "Databases now carry an initialized_at marker (migration 0048) stamped once the volume's contents have been made consistent with THIS row's credentials; the adoption gate re-arms whenever the marker is NULL and the row sits in creating/error. Healthy rows — including pre-marker rows that always owned their volume — skip the gate, so restarts never trip the non-rekeyable-engine refusal",
          "The gate (needsVolumeAdoption) is wired into all four start paths: API create, the Hub-provisioning retry (reuseExisting), the explicit start route, and template reconcile",
        ],
      },
      {
        t: "Doctor Accuracy & Honesty",
        items: [
          "Doctor no longer mistakes every compose stack's network for an orphan: compose networks are named ndcmp-<slug>_default and the scan compared the full name (suffix included) against service slugs — it never matched, flagging healthy stacks as 'no owner' and offering a delete for a stopped-but-existing stack's live network. The project suffix is now stripped before the ownership check",
          "Doctor fix refusals answer 409 with the reason, not an opaque 500: the guarded re-checks (container came back running, volume gained an owner, row gone, deploy moved on) threw plain errors that the global handler turned into 500s, hiding the actionable message in production. They now throw proper conflicts",
          "Volume deletion verifies the removal landed: a failed docker volume rm (volume still mounted by a container) no longer reports 'Fixed' while the volume survives on disk",
          "Re-key progress is visible — capture() silently ignored the heartbeat options, so a slow postgres re-key sat silent for up to its 5-minute timeout; heartbeats now flow through an optional onProgress sink",
          "The Doctor panel seeds its query cache with the fix response's post-fix report instead of invalidating (a third full scan per click), and the Doctor sidebar link is hidden from non-operators",
        ],
      },
    ],
  },
  {
    version: "0.4.3",
    date: "2026-09-01",
    status: "stable",
    notes: [
      {
        t: "Fixed — Retained Database Volumes",
        items: [
          "Redeploying a template over a deleted database no longer dies silently at the healthcheck. Deleting a database intentionally keeps its Docker volume, but the postgres/mysql family only reads *_PASSWORD-style env vars during FIRST initialization of an empty volume — so a fresh database row (with a freshly generated password) remounting a retained volume booted a server whose real credentials belonged to the deleted installation, then crash-looped on auth failures with no explanation, every retry, forever",
          "Callers that create a new database row now run adoptRetainedVolume before starting it: postgres is re-keyed automatically — a throwaway sidecar running the cluster's own image (ninedeploy.database.image volume label, falling back to the row's configured version) opens the data directory in single-user mode and rewrites the role's password, with success verified by a catalog probe inside the same session",
          "redis/valkey need nothing — their credentials live on the container, not in the volume. mysql/mariadb/mongo/clickhouse/rabbitmq/meilisearch have no automatic re-key: the deploy fails up front with the volume's provenance and the exact remediation (docker volume rm <name> / Volumes panel) instead of an opaque healthcheck timeout",
          "A labeled retained volume belonging to a different engine is refused outright instead of being mounted as garbage, and creating a database with an existingVolume that already belongs to another database row is refused with a 400 instead of silently sharing (and re-keying) another database's data directory",
        ],
      },
      {
        t: "Doctor Mode — Host-Wide Analysis + Guarded Cleanup",
        items: [
          "A new GET /v1/doctor scan answers 'what is dead, stale or bloated on this host': exited Hub containers nobody claims, orphaned managed volumes and leftover bridge/compose networks (with their ninedeploy.* provenance), services marked running whose runtime container is gone, databases marked running with a dead container or stuck in creating, deployments frozen in queued/building, dangling image layers, oversized builder cache and disk pressure — each with severity, reclaimable size where applicable, and a one-click repair",
          "POST /v1/doctor/fix re-scans and re-locates the finding against FRESH state before executing, so a stale panel can never delete a volume that gained an owner or kill a container that came back (it gets a 409 instead); destructive targets are additionally name-family-guarded (nd-* / ninedeploy-* / ndcmp-* only) and volume deletion refuses anything whose owner row reappeared",
          "Repairs reuse existing safe paths (managed startDatabase, audited volume removal, age-filtered builder prune, auto-prune) instead of raw prunes. Panel: a new Doctor page in the System group (operator-gated) with severity-grouped findings, host facts and per-finding fixes with confirmation for the destructive ones; SDK ships the same surface as client.doctor.scan/fix",
        ],
      },
      {
        t: "Volume Provenance & Hardening",
        items: [
          "Every managed database volume is created with ninedeploy.managed=database plus its slug, display name, engine, the exact initializing image, owning user, container name and — for template provisioning — the template id. The Volumes panel shows retainedFrom (name + engine) for ownerless volumes, so a retained volume can always be traced back to the database that created it even after the row is gone",
          "Template-generated secrets (secret: true) are now 32 bytes (43 base64url chars) instead of 18, so variables like Directus SECRET or n8n N8N_ENCRYPTION_KEY can never fall under ecosystem 32-character minimums. Existing installs keep their stored values — generation only happens on first install",
        ],
      },
    ],
  },
  {
    version: "0.4.2",
    date: "2026-08-31",
    status: "stable",
    notes: [
      {
        t: "Plugin Audit & Fixes",
        items: [
          "NotificationsDispatcherPlugin ships a command:palette menuItem now — the plugin listened on deployment / service.health_changed / backup.completed and emitted notification.queued, but had no menuItems entry at all, so the only path to its config was the hidden /settings?section=plugins URL. The new entry points to /settings?section=notifications",
          "TelemetryStreamerPlugin actually POSTs to export_endpoint now — the configSchema exposed the field and the description said records were pushed, but the init handler only re-emitted telemetry.recorded as a pass-through and the endpoint was silently ignored. Wires a real fetch() with HMAC-SHA256 signing (X-NineDeploy-Signature: sha256=<hex>) and a per-request AbortSignal timeout; failures land on telemetry.export.error custom events",
          "TelemetryStreamerPlugin wildcard filter drops telemetry.recorded (recursion guard) and telemetry.export.error (a non-2xx response re-emitted itself as telemetry.recorded, re-fetched, re-failed, and OOMed the test process — the export now short-circuits before the loop can build). Also drops plugin.* / config.* so a plugin.registered tick never surfaces as user-facing audit data",
          "Layout sidebar no longer leaks command:palette items into the Extensions group. Every built-in plugin that registered any menuItems ended up in the rail-mounted Extensions group regardless of slot — Build Cache, Webhook Out, Domain Presets, Sticky IP showed up in BOTH the Cmd+K palette AND the sidebar. Filter menus.data to m.slot === 'sidebar:secondary' so only Cloudflare Tunnels (the only built-in plugin that uses that slot) lands in the rail",
          "ConfigPresetsPlugin menuItem repointed from /settings/presets (no such route) to /settings?section=config, where the panel renders the preset.list / preset.<id>.values rows the plugin owns",
          "plugin-sdk MenuSlot union extended with database:tabs — the slot was in the kernel's runtime type but missing from the SDK type, so an external plugin declaring a database-tab menuItem would compile against the SDK and then have the kernel reject the row at runtime. SDK now mirrors the kernel exactly",
        ],
      },
      {
        t: "Deploy Queue Management",
        items: [
          "Global queue page at /deploys — every in-flight (queued / building / deploying) deploy across every service the caller can see, with one-click cancel + remove, per-service position chip on queued rows (#3 of 5 next to the timestamp), 3s auto-refresh, and a DeployQueueBadge in the top bar that hides when the queue is empty and pulses while a row is live. Member sessions see only the rows on services they can admin",
          "Multiple queued deploys per service (50-row cap) — the old dedup short-circuited on ANY queued/building match, so a services deploy click during a long build silently dropped. Split into in-flight (still wins) + per-service queued (cap 50, returns the actual row)",
          "Cancel + remove routes on services.deploys — queued deploys stop immediately, in-flight ones stop at the next pipeline step boundary with the previous version still serving. Remove refuses in-flight (cancel first) and refuses the running row (it carries the digest a rollback re-deploys)",
          "CLI: ninedeploy deploys queue — same data the web panel's /deploys page renders, with per-service 1-based queue position (queued rows only; in-flight rows get a dash so the column reads cleanly) and a by-status k/v block at the bottom (queued / building / deploying) so the operator can confirm the empty state at a glance",
          "MCP: list_queue + remove_deploy tools register the matching requiredScopes (read for queue, write for remove) so a read-only token can list the queue but cannot delete a deploy — same gate the SDK + HTTP layer enforce",
          "Longest-match sidebar routing — Layout.findGroup now picks the longest prefix match, not the first one. Plugin-contributed menu items register routes like /settings/extensions/<plugin-id>; the static System group also owns /settings, so a first-match lookup routed every plugin click into System and the user landed in the wrong panel",
        ],
      },
      {
        t: "Integration Coverage",
        items: [
          "SDK ↔ server queue end-to-end test — wires the real SDK client to the real Fastify route via Fastify's app.inject() (no port binding, no real network). A custom fetch translates the SDK's standard Authorization: Bearer <token> header to the in-process test app's x-test-user header. Pins the contract that the SDK schema and the route JSON agree — a renamed response key, a removed field, a 404 that became a 400, an SDK shape that no longer matches the route JSON will all surface here first",
        ],
      },
      {
        t: "Installer & Release",
        items: [
          "Strict-semver tag validation in the release workflow. The trigger on: push: tags: ['v*'] accepted any v-prefixed ref — v0.4.0-foo, v0.4.0+build.1, even a stray v0.4.0 with trailing whitespace. install.sh and selfUpdate.ts only resolve ^v\\d+\\.\\d+\\.\\d+$, so pushing a different shape would build a real image no install path can ever reach. A new first step fails fast on anything that does not match strict semver",
          "Multi-arch release build — the ci.yml publish-image job was already multi-arch (linux/amd64 + linux/arm64), but the release tag pipeline (which is what install.sh --docker actually pulls) was silently amd64-only. Every ARM host (Raspberry Pi, AWS Graviton, Apple-Silicon-as-target) hit a no matching manifest error on docker pull. Mirrors the daily edge build's architecture coverage",
          "Marketplace catalog shape smoke test — every entry in MARKETPLACE_CATALOG is walked and asserted against the shape the loader depends on (id / name / version / menuItem id+slot+label+route+route-format / configSchema key+label+isSecret). A typo in a new catalog entry would have shipped as a row the panel could show but not install; the test makes that fail in CI",
        ],
      },
    ],
  },
  {
    version: "0.4.1",
    date: "2026-08-31",
    status: "stable",
    notes: [
      {
        t: "Installer & Release",
        items: [
          "CI publishes the panel image to GHCR on every push to main — a fresh `install.sh --channel=main` lands on a current image, not a stale one. The multi-arch build is tagged `:edge`; the existing tag-push flow re-tags `:latest` for the release channel",
          "`install.sh` substitutes the right tag (`:edge` for main, `:latest` for release) into the rendered compose file, and a preflight `docker manifest inspect` runs before `compose pull` so a private GHCR package surfaces a clear one-line error instead of the generic 'image pull failed'",
          "The v0.4.0 tag was rolled forward to v0.4.1 to bring the post-Sprint 11 fixes and the GHCR pipeline into a single coherent release. No more `vX.Y.Z-hotfixN` tags — patch fixes ship as the next semver patch so `install.sh` and the one-click panel self-update can find them through `^v\\d+\\.\\d+\\.\\d+$` without manual version pinning",
        ],
      },
      {
        t: "Sprint 11 PR #58 coverage",
        items: [
          "200+ tests across 17 new files covering the Sprint 11 surface (PRs #45–#58). Server 88.12% → 93.53% statements, 86.00% → 88.31% branches; CLI 73% → 84% on the back of the `test/index.test.ts` restore; SDK 100% on every axis. Thresholds re-bumped to server 93.6/88.4/93/95.1, CLI 83/80/80/83",
          "`stickyIpPlugin.ts`: 32% → 100% on every axis, driving the real `NineDeployKernel` event bus + `configCenter` + `IEgressIpDriver` through the metadata, attach, detach and destroy lifecycle",
          "`swarmOrchestrator.ts`: 42% → 100% statements / 100% lines, with a cross-platform in-memory `node:fs` shim covering the network / secret / config / service create + update paths, every `getStackStatus` replica state label, the `readState` file-vs-DB fallback, and the ordered `removeStack` with best-effort docker rm tolerance",
          "`localOrchestrator.ts`: 60% → 97% statements / 98% lines, every `renderCompose` block, `deployStack` failure modes, `removeStack` best-effort paths, `getStackStatus` null paths, and `listStacks` STACK_ROOT unreadable",
          "`auth.ts`, `stats.ts`, `notifications.ts`, `backups.ts`, `manifest.ts`, `templates.ts` hub — every Sprint 11 module lifted to ≥97% statements with dedicated tests for the operator-vs-scope gates, the per-resource scope superset rule, channel CRUD, the per-database route branches, the `diff.build` field branches, and the community-merge collision drop",
        ],
      },
      {
        t: "Fixed (post-Sprint 11)",
        items: [
          "`serviceBridge` test premise — docker `network ls` / `inspect` output preserves the bridge name verbatim, so the lib's literal-string search matches correctly and every ensure/connect/reap/reconcile call is idempotent (the lib was right; the tests were not) (16/16)",
          "`imageInventory.pruneImages.keepLast` semantics — the loop now protects exactly the newest N and leaves the rest as candidates, instead of the previous inverse-of-docstring behaviour that made `keepLast = 0` a silent no-op (45/45)",
          "`marketplaceCatalog.decodeKey` Node 24 raw 32-byte Ed25519 import — the key is now imported as a JWK, the only form Node's key importer accepts for an OKP public key, so the signed marketplace index verifies cleanly (16/16)",
          "`localOrchestrator.listStacks` service-count regex was always 0 for any compose file with body under each service entry — a per-block scanner now counts top-level service lines inside the `services:` block and excludes 4+-space-indented body lines (24/24)",
          "release-publish workflow: the inline empty `branches: []` was a parse-time failure (GitHub rejected the workflow at parse with 'A sequence was not expected', every run since 4fd2bc4 produced 0 jobs). The key is redundant with `on: push: tags` and was dropped; the publish-image job is granted `contents: write` so the GitHub Release step can call `POST /repos/.../releases`",
        ],
      },
    ],
  },
  {
    version: "0.3.4",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "One-Click Panel Self-Update",
        items: [
          "A banner under the header offers new releases to operators; confirming runs this install's own installer for the pinned exact tag — data snapshot, source swap, rebuild, migrations, service restart",
          "On systemd hosts the updater detaches through systemd-run into its own cgroup so it survives stopping the unit it belongs to; progress survives the panel restart it performs and failure reports the installer output tail",
          "The updater's environment is deliberately narrow — no JWT or database secrets are reachable via systemctl show while it runs",
        ],
      },
      {
        t: "Records Tell The Truth",
        items: [
          "Deployment history no longer shows every past deploy as Running forever — a new superseded state settles older rows both at finalize time and during a boot-time reconciliation pass",
          "Volume snapshots carry labels (manual / schedule-… / operator tags) across the Backups page, alongside scope and volume names",
          "Auto-deploy webhook URLs are built from the Settings panel domain instead of falling back to localhost, and the environment tab warns when a stored URL is unreachable from git providers",
        ],
      },
      {
        t: "Smaller but real",
        items: [
          "The scheduled-jobs editor is rebuilt around cron presets with human-readable descriptions and next-run chips; env vars gain a raw .env bulk-editing mode",
          "Detaching a volume now queues a redeploy instead of demanding the service be stopped first",
          "Alert rules expose lastEvaluatedAt so a lapsed collector cannot masquerade as a passing rule",
        ],
      },
      {
        t: "CI & Packaging",
        items: [
          "Every CI job had been dying in seconds on ERR_PNPM_BAD_PM_VERSION — workflows pinned pnpm 11.22.0 while package.json declares 11.23.0; the pin is removed and the version derives from packageManager",
          "Node ≥ 26 images no longer bundle corepack, so the Dockerfile installs a pinned pnpm via npm in both stages — the CI Docker-image-build job and tagged release images work again",
        ],
      },
    ],
  },
  {
    version: "0.3.3",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Full-System Audit Hardening",
        items: [
          "Preview domains could route hosts nobody verified: PR-preview Traefik domains went active with a free-form pattern and skipped ownership proof — rendered preview hostnames are now constrained to the instance wildcard zone before routing goes active",
          "The .ninedeploy manifest's database.ref resolved by slug with no access decision, letting repo pushes pull another tenant's managed-database connection string into their runtime — attachments now require the deploying service's owner to see that database",
          "Webhook-created deploys bypassed the host-privilege gate manual deploys honor: both webhook branches now authorize against the service owner",
          "PR previews copied the parent's secrets into environments built from PR code — previews inherit non-secret configuration only, and the webhook response reports how many secrets were withheld",
          "Server-side git clones are egress-gated across all three transports; every DNS answer must be public (LAN remotes keep working via NINEDEPLOY_ALLOW_PRIVATE_EGRESS=1)",
          "Log drains moved onto the same guarded fetch as notification webhooks — drain bodies carry raw log lines, making them the better exfil sink",
        ],
      },
      {
        t: "Reliability Fixes",
        items: [
          "Compose redeploys deleted the deployment they had just shipped — finalize now recognizes in-place redeploys instead of tearing the stack down two seconds after go-live",
          "A Docker daemon outage at boot no longer kills the panel; the readiness hook heals failed-open like every other background subsystem",
          "Migration 0031 sorted before 0030 and would never apply on databases migrated during the interim window; reordered monotonically with replay-safe guards",
          "Deleting a service mid-deploy returns 409 instead of orphaning a fully running candidate container",
          "Pre-upgrade backup archives are created under umask 077 — master.key used to land world-readable on shared hosts",
        ],
      },
    ],
  },
  {
    version: "0.3.2",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Honest Runtimes",
        items: [
          "Manifest Creator presets pinned Node 20, Python 3.12 and Go 1.22 — all three had lost upstream support months earlier; the defaults are now Node 24 (Active LTS), Python 3.14 and Go 1.27, plus Ruby, PHP, Java and Rust",
          "Every version NineDeploy suggests comes from one curated catalog instead of literals duplicated across the panel and the CLI, and the catalog records the date it was last reviewed so staleness is visible rather than silent",
          "The Version field is a picker showing each version's support status, with an escape hatch for anything else — end-of-life versions stay selectable, they just carry an advisory naming the recommended pin",
        ],
      },
      {
        t: "Manifest Build Sections",
        items: [
          "The manifest's build half (runtime, phases, build) is not applied at build time — the pipeline applies only routes, alerts and database. The docs and the panel now say so instead of implying a pin that never happens",
          "Every runtime pin the nixpacks.toml generator produced was broken: wrong nixpkgs attribute names for Go and Ruby, nonsense for any patch-level pin, and a package list that replaced the provider toolchain instead of extending it",
          "Pins now go only through the provider environment variables Nixpacks 1.41.0 actually reads, and one it cannot honour returns a specific warning rather than quietly building a different version",
        ],
      },
    ],
  },
  {
    version: "0.3.1",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Boot Fix For 0.3.0",
        items: [
          "0.3.0 could not start — every boot died with \"Cannot access 'NETWORK' before initialization\" and systemd restarted it forever",
          "Two engine modules imported each other while one evaluated the other's constant at module scope, so the entry graph decided whether it was initialised yet; the shared Docker names moved into a module that imports nothing",
          "A new test walks the server module graph and fails on any import cycle — a type checker cannot see a temporal dead zone, so this could only surface in production",
          "A failed readiness check now prints systemd status, the last 60 journal lines and the health port owner, and a crash-loop ends the wait immediately instead of sitting through the whole window",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Tags, Volumes & The .ninedeploy Manifest",
        items: [
          "Services tag into many projects, workspaces and labels at once, with a top-bar filter that composes all three",
          "Per-service volume attachments: mount any number of managed Docker volumes at explicit container paths",
          "Volume backups with retention pruning, off-site copies, and a restore that refuses to run under a live service",
          "`.ninedeploy` manifest with `manifest init/validate/show` — schema-checked and secret-scanned before it reaches git",
          "Private-repo deployment and auto-deploy webhooks from the CLI, plus workspace invitations for addresses without an account yet",
          "A new Organize menu puts Workspaces, Projects and the new Labels page in the navigation — projects had a route with no menu entry, and labels had no management screen at all",
          "Volume snapshots, restore and download from the Volumes page, including retained volumes that belong to no service",
        ],
      },
      {
        t: "Installer",
        items: [
          "The release channel installs the source tarball GitHub publishes for the tag instead of cloning — no git needed on the host, and no half-fetched shallow checkout",
          "The newest tag is resolved from git ls-remote, then the GitHub releases API, then the tags API, so one unavailable source cannot pin you to a stale version",
          "Build output and the turbo cache are cleared before every rebuild, and the installer verifies the built version against the requested tag — an upgrade can no longer keep serving the previous panel bundle",
          "New --force flag discards local modifications and rebuilds from scratch",
        ],
      },
      {
        t: "Upgrade & Correctness Fixes",
        items: [
          "Implemented the three managed-volume helpers the backup routes imported but that were never written — the server package did not build without them",
          "Finished the service tagging migration in the services API, which still read the removed single-project column",
          "Fixed an upgrade that blocked every install from 0.2.2 onward: a column added at boot collided with its own later migration and the panel would not start",
          "Restored 90 source files whose non-ASCII characters had been double-encoded, and the workspace role fields a bad rename had renamed away",
          "A label created from the top-bar filter no longer disappears the moment it is added",
          "Menu permissions fail closed: an operator-gated item is hidden, not shown, when the flag is absent",
        ],
      },
    ],
  },
  {
    version: "0.2.36",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Runtime Resilience & Hardening",
        items: [
          "Self-healing runtime state: stopped containers, dead PM2 daemons and pruned proxies are revived automatically",
          "Boot resilience — Docker enabled at boot, a systemd unit for bare-metal PM2 deployments, restart policies on Compose services",
          "Streaming AES-256-GCM database backups, so a large dump never has to fit in server memory",
          "Read-only MCP mode (`NINEDEPLOY_MCP_READONLY=1`) exposing a fail-closed inspection allowlist",
          "Tenant isolation across domain, metrics, topology, network and volume views",
        ],
      },
    ],
  },
  {
    version: "0.2.2",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Platform Hardening & Cross-Platform Stability",
        items: [
          "Cross-platform file URL normalization for @ninedeploy/mcp AI server",
          "Installer readiness healthcheck bash loop scoping hardening",
          "First-run admin setup and database transactional initialization improvements",
          "100% test coverage verification and zero-error pipeline across all 9 monorepo packages",
        ],
      },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "NPM Distribution & CLI Packaging",
        items: [
          "Published CLI package as `ninedeploy` to npm registry for instant npx execution",
          "Public packaging for @ninedeploy/sdk, @ninedeploy/schemas, @ninedeploy/plugin-sdk, and @ninedeploy/mcp",
          "Streamlined monorepo release automation and multi-package dependency publishing",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Workspaces & SSO",
        items: [
          "Multi-tenant workspace isolation with Owner / Admin / Member / Viewer RBAC",
          "OpenID Connect (OIDC) Single Sign-On (Google, GitHub, Okta, Keycloak)",
          "WebAuthn Passkeys hardware authentication & TOTP 2FA",
          "Zero-touch SSH remote server provisioning & auto-discovery",
        ],
      },
      {
        t: "Microkernel & Extensions",
        items: [
          "Microkernel event bus and waterfall hook pipeline (deploy.before / deploy.after)",
          "Central Configuration Center with Dual-Vault AES-256-GCM encryption",
          "Plugin SDK with MenuRegistry and ServiceRegistry driver interchange",
          "35-tool Model Context Protocol (MCP) server for AI assistants",
        ],
      },
      {
        t: "Databases & Operations",
        items: [
          "Extended managed engines: Postgres (pgvector), MySQL, MariaDB, Redis, Valkey, ClickHouse, Meilisearch, RabbitMQ, Mongo",
          "Live in-browser Container Filesystem Manager with drag & drop",
          "Sustained-breach alerting rules with Telegram, Discord, Slack, Ntfy, Webhook, SMTP",
          "Ephemeral PR preview staging environments and 1-click demo stack",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-08",
    status: "stable",
    notes: [
      {
        t: "Dokploy-parity wave",
        items: [
          "Deploy cancellation at all pipeline stages",
          "Webhook watch paths & monorepo path filters",
          "Cron-scheduled jobs and container commands",
          "S3 off-site backup destinations with SigV4 client",
          "Compose service type with ndcmp- prefix",
          "Multi-server typed agent protocol",
          "Service export/import migration bundles",
          "Brute-force lockout & password reset flows",
        ],
      },
      {
        t: "UX & Engine",
        items: [
          "Command palette (Ctrl/Cmd+K)",
          "Real-time WebSocket build log streaming with replay",
          "Tabbed service detail with live container metrics",
          "Digest-pinned zero-downtime blue-green rollback",
          "systemd notify watchdog integration",
        ],
      },
    ],
  },
  {
    version: "0.0.x",
    date: "2026-07",
    status: "internal",
    notes: [
      {
        t: "Foundations",
        items: [
          "Fastify core + Zod schemas + typed SDK",
          "Blue-green Docker builder & PM2 process supervisor",
          "Traefik ingress + ACME HTTP-01 & DNS-01 wildcard certificates",
          "Managed databases + AES-256 encrypted backups",
          "Alerting, notifications, and immutable audit logs",
          "52-template app store with automatic secret provisioning",
        ],
      },
    ],
  },
];

export function Changelog() {
  return (
    <>
      <section className="grid-bg border-b-2 border-edge dark:border-line">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <div className="tag mb-3">git log --oneline</div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">Changelog</h1>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-4 py-14">
        {releases.map((r, ri) => (
          <div key={r.version} className="relative border-l-2 border-edge dark:border-line pl-8 pb-14">
            <span
              className={`absolute -left-[9px] top-1.5 w-4 h-4 border-2 border-ink dark:border-phosphor ${
                ri === 0 ? "bg-phosphor dark:bg-phosphor animate-pulse" : "bg-white dark:bg-panel"
              }`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold font-mono">v{r.version}</h2>
              <span className="tag">{r.status}</span>
              <span className="font-mono text-xs text-zinc-500">{r.date}</span>
            </div>
            <div className="mt-5 space-y-5">
              {r.notes.map((g) => (
                <div key={g.t} className="panel p-5">
                  <div className="font-mono text-xs uppercase tracking-widest text-phosphor-dim mb-2">
                    {g.t}
                  </div>
                  <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {g.items.map((it) => (
                      <li key={it} className="text-sm text-zinc-700 dark:text-zinc-300 flex gap-2">
                        <span className="text-phosphor-dim">+</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
