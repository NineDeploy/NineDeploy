# Plugins SDK & Microkernel Architecture

NineDeploy features an extensible Microkernel architecture allowing developers to hook into the deployment lifecycle, register custom UI navigation menus, and swap core driver implementations.

---

## 🔌 1. Kernel Events & Waterfall Hooks

The kernel exposes two integration surfaces: a typed **event bus** (`ctx.events.on`) for observing lifecycle activity, and sequential **waterfall hooks** (`ctx.tapHook`) that can inspect — and in some cases abort or amend — pipeline steps.

### Events (`events.on(event, handler)`)

The bus is fed from the application's audit stream — every `audit()` call, which
is the one choke point each meaningful state change already passes through (see
`kernel/auditBridge.ts`). These events **fire today**:

| Event | Source |
| :--- | :--- |
| `audit.recorded` | Every audit entry, raw: `{ action, entity, actorUserId, ts }`. Subscribe here for anything the table below does not cover. |
| `deployment.status_changed` | Bridged from `deploy.*` (start / success / failed / rollback / cancel) |
| `service.health_changed` | Bridged from `service.start` / `stop` / `restart` |
| `backup.completed` | Bridged from `backup.create` |
| `alert.triggered` | Bridged from `alert.fired` / `alert.recovered` |
| `plugin.registered`, `plugin.reloaded`, `plugin.status_changed` | Kernel lifecycle |
| `notification.queued` | Emitted by the built-in notifications plugin as an **extension point**. It is not the delivery path: `lib/notifier` owns channels, retries and the delivery log, so consuming this and sending would double every alert. |
| `telemetry.recorded`, `tunnel.route_evaluated` | Built-in telemetry / Cloudflare-tunnel plugins |

`DomainEvents` in `kernel/types.ts` declares more names than this
(`service.created`, `database.created`, `server.announced`, `config.changed`, …).
They are typed for forward compatibility but **nothing emits them yet** — use
`audit.recorded` and match on `action` if you need one of those today.

### Sequential hooks (`tapHook(name, fn)`)

| Hook Name | Lifecycle Trigger | Capabilities |
| :--- | :--- | :--- |
| `deploy:before` | Prior to build/clone | Inspect the service/target commit; abort deployments |
| `deploy:build_complete` | Image built | Observe image tag & build duration |
| `deploy:healthcheck` | After health probe | React to healthy/unhealthy candidates |
| `deploy:after` | Post-switchover | Send custom Slack/Discord alerts, trigger webhooks |
| `database:before_delete` | Before a database removal | Veto via `allowOrAbort` |
| `database:after_create` | New database provisioned | Provision sidecars, seed data |
| `proxy:sync_routes` | Traefik route sync | Inspect the resolved domains/services |
| `server:before_announce` | Agent enrolment | Validate/reject joining nodes |

```typescript
import { definePlugin } from '@ninedeploy/plugin-sdk';

export default definePlugin({
  id: 'my-custom-hook',
  name: 'Custom Hook Plugin',
  version: '1.0.0',
  init(ctx) {
    // Pick an event from the "fires today" table above. `service.deployed` is
    // declared but not emitted yet — `deployment.status_changed` is its live
    // equivalent.
    ctx.on('deployment.status_changed', (payload) => {
      console.log(`Deployment ${payload.deploymentId} -> ${payload.status}`);
    });
    const untap = ctx.tapHook('deploy:before', () => {
      // return a rejection context for hooks that support it
    });
    void untap;
  },
});
```

The official plugins shipped in-tree are the reference implementations for the
event and hook APIs. Read them for shape, not for behaviour: the notifications
dispatcher re-emits `notification.queued` as an extension point rather than
delivering anything (`lib/notifier` owns delivery), and the Cloudflare Tunnels
plugin observes proxy hooks.

### Installing plugins

**NineDeploy does not load third-party plugin code.** There is no `import()` of
an external package anywhere in the loader, so `npm`, `git` and `local` installs
are refused rather than creating a row that reports itself active while doing
nothing. The marketplace catalog in Settings → Plugins is a roadmap index:
every entry carries `implemented` (all of them are `false` today) and, where the
capability already ships under another name, a pointer to it — S3 replication is
Backups → Storage destinations, Slack/Discord/Telegram are Settings →
Notifications, Cloudflare DNS is Settings → System, and so on.

Real plugin loading needs fetching, integrity verification, sandboxing and an
upgrade story. Until that exists, the honest answer is a refusal with a pointer,
not a green "Installed" badge.
## 🗂️ 2. Dynamic UI Menus & Driver Registries

- **MenuRegistry**: Inject custom navigation tabs, submenus, and action buttons into the Web Dashboard.
- **ServiceRegistry**: Interchange core storage and deploy drivers dynamically at runtime.
- **ConfigCenter Integration**: Read and persist encrypted plugin configurations in the central key-value store.
