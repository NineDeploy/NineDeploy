# Plugins SDK & Microkernel Architecture

NineDeploy v0.2.0 features an extensible Microkernel architecture allowing developers to hook into the deployment lifecycle, register custom UI navigation menus, and swap core driver implementations.

---

## 🔌 1. Microkernel Event Bus & Hooks

The kernel exposes an event emitter and waterfall hook pipeline:

| Hook Name | Lifecycle Trigger | Capabilities |
| :--- | :--- | :--- |
| `deploy.before` | Prior to build/clone | Inspect/modify build arguments, abort deployments |
| `deploy.after` | Post-switchover | Send custom Slack/Discord alerts, trigger webhooks |
| `service.created` | Service registration | Provision secondary resources or sidecars |
| `database.backup` | Snapshot completion | Replicate backups to secondary cloud providers |

```typescript
import { definePlugin } from '@ninedeploy/plugin-sdk';

export default definePlugin({
  id: 'my-custom-hook',
  name: 'Custom Hook Plugin',
  version: '1.0.0',
  setup(kernel) {
    kernel.hooks.tap('deploy.after', async (context) => {
      console.log(`Service ${context.service.name} deployed successfully!`);
    });
  },
});
```

---

## 🗂️ 2. Dynamic UI Menus & Driver Registries

- **MenuRegistry**: Inject custom navigation tabs, submenus, and action buttons into the Web Dashboard.
- **ServiceRegistry**: Interchange core storage and deploy drivers dynamically at runtime.
- **ConfigCenter Integration**: Read and persist encrypted plugin configurations in the central key-value store.
