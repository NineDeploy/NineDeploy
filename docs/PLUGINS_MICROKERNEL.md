# Plugins SDK & Microkernel Architecture

NineDeploy features an extensible Microkernel architecture allowing developers to hook into the deployment lifecycle, register custom UI navigation menus, and swap core driver implementations.

---

## 🔌 1. Kernel Events & Waterfall Hooks

The kernel exposes two integration surfaces: a typed **event bus** (`ctx.events.on`) for observing lifecycle activity, and sequential **waterfall hooks** (`ctx.tapHook`) that can inspect — and in some cases abort or amend — pipeline steps.

### Events (`events.on(event, handler)`)

| Event | Payload |
| :--- | :--- |
| `service.created` / `service.deployed` / `service.deleted` | Service + deploy ids |
| `service.health_changed` | Health status transitions |
| `deployment.status_changed` | Deploy lifecycle changes |
| `database.created` / `database.backup_completed` / `database.backup_failed` | Database lifecycle & snapshots |
| `server.announced` / `server.connected` / `server.disconnected` | Remote agent fleet events |
| `alert.triggered`, `notification.queued`, `notification.sent` | Alerting pipeline |
| `config.changed`, `plugin.registered`, `plugin.reloaded` | Config center & kernel state |

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
    ctx.on('service.deployed', (payload) => {
      console.log(`Service ${payload.serviceId} deployed!`);
    });
    const untap = ctx.tapHook('deploy:before', () => {
      // return a rejection context for hooks that support it
    });
    void untap;
  },
});
```

The official plugins shipped in-tree are the reference implementations — the notifications dispatcher subscribes to events and fans alerts out to Telegram/Discord/Slack/webhooks, and the Cloudflare Tunnels plugin drives routes from the proxy hooks.
## 🗂️ 2. Dynamic UI Menus & Driver Registries

- **MenuRegistry**: Inject custom navigation tabs, submenus, and action buttons into the Web Dashboard.
- **ServiceRegistry**: Interchange core storage and deploy drivers dynamically at runtime.
- **ConfigCenter Integration**: Read and persist encrypted plugin configurations in the central key-value store.
