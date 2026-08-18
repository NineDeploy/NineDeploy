# AI MCP Server, CLI & TypeScript SDK

NineDeploy is API-first. You can manage and automate your infrastructure via the official **Model Context Protocol (MCP)** server, interactive CLI, or typed TypeScript SDK.

---

## 🤖 1. Model Context Protocol (MCP) for AI Assistants

NineDeploy includes an official stdio MCP server exposing **35 dedicated tools** to AI agents (Claude Desktop, Cursor, Antigravity, Cline).

### Adding to Claude Desktop / Cursor Config:
```json
{
  "mcpServers": {
    "ninedeploy": {
      "command": "npx",
      "args": ["-y", "@ninedeploy/mcp"],
      "env": {
        "NINEDEPLOY_URL": "https://your-ninedeploy-server.com",
        "NINEDEPLOY_API_TOKEN": "nd_tok_xxxxxxxxxxxx"
      }
    }
  }
}
```

### Available MCP Tools (Sample):
- `list_services`, `get_service`, `deploy_service`, `rollback_deploy`, `service_logs`
- `list_databases`, `list_domains`, `list_projects`, `list_workspaces`
- `list_container_files`, `inspect_container`, `get_container_compose`
- `list_plugins`, `install_plugin`, `enable_plugin`, `disable_plugin`
- `system_stats`, `topology`, `health`, `system_autoprune`

---

## 💻 2. NineDeploy Interactive CLI (`ninedeploy`)

```bash
# Global installation
npm install -g ninedeploy

# Login to your instance
ninedeploy login

# List and deploy services
ninedeploy services
ninedeploy deploy <service-id-or-name>

# Stream live container logs
ninedeploy logs <service-name> --follow

# Inspect system status and trigger autoprune
ninedeploy status
ninedeploy system autoprune
```

---

## 📦 3. TypeScript SDK (`@ninedeploy/sdk`)

```typescript
import { createClient } from '@ninedeploy/sdk';

const client = createClient({
  baseUrl: 'https://your-ninedeploy-instance.com',
  token: 'nd_tok_xxxxxxxxxxxx',
});

// List all services in a workspace
const services = await client.services.list();
console.log(`Found ${services.items.length} active services`);

// Trigger deployment
const deploy = await client.deploys.trigger(serviceId);
console.log(`Deployment ${deploy.id} started with status: ${deploy.status}`);
```
