# Operational Troubleshooting & Diagnostics

Common operational edge cases, recovery steps, and diagnostic procedures for NineDeploy.

---

## 🛑 1. Docker Daemon / Socket Permission Denied

**Symptoms**:
- Deployment logs show `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`.
- Service container creation fails with `permission denied`.

**Resolution**:
- If running under **bare-metal**:
  ```bash
  sudo usermod -aG docker ninedeploy
  sudo systemctl restart ninedeploy
  ```
- If running under **Docker**:
  Ensure the host's docker group GID is passed via `--group-add`:
  ```bash
  docker run ... --group-add $(getent group docker | cut -d: -f3) ...
  ```

---

## 🔒 2. Database Locked (`SQLITE_BUSY`)

**Symptoms**:
- API responses return `database is locked` during concurrent high-throughput operations.

**Resolution**:
1. Check for long-running backup processes holding locks.
2. Ensure WAL (Write-Ahead Logging) mode is active:
   ```bash
   sqlite3 .data/ninedeploy.db "PRAGMA journal_mode=WAL;"
   ```
3. Restart the systemd service to flush pending transactions.

---

## 🩺 3. Healthcheck Flapping & Deployment Timeouts

**Symptoms**:
- Blue-green deployment times out and rolls back after container boot.

**Resolution**:
1. Check the service's internal health check path (`/health`, `/api/health`, or custom port).
2. Inspect new container logs before teardown:
   ```bash
   ninedeploy logs <service-name>
   ```
3. Increase `healthCheckTimeout` in service configuration if the application has a long cold-start initialization phase.

---

## 🌐 4. Let's Encrypt Certificate Issuance Failures

**Symptoms**:
- Service routes return self-signed Traefik default certificate instead of valid Let's Encrypt certificate.

**Resolution**:
1. Verify DNS records: Ensure both apex and subdomains point directly to your server's public IP address (`A` record).
2. Ensure port `80` and `443` are open and not blocked by cloud provider firewalls / security groups (AWS Security Groups, Hetzner Firewall, UFW).
3. If using Cloudflare proxy (orange cloud), ensure SSL mode is set to **Full (Strict)**.
