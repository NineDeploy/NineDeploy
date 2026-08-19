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

---

## 🔌 5. CLI Connection & Server Discovery Failures

**Symptoms**:
- Running `ninedeploy services list` or `ninedeploy init` prints `fetch failed` or `ECONNREFUSED`.

**Resolution**:
1. Run `ninedeploy doctor` to test network and socket connectivity.
2. Check configured target server URL:
   ```bash
   ninedeploy config
   ```
3. If connecting to a remote server, update the base URL:
   ```bash
   ninedeploy config --server https://panel.yourdomain.com
   ```
4. If connecting locally, check if the Docker container is active:
   ```bash
   ninedeploy server status
   ninedeploy server start
   ```

---

## 🐳 6. Local Server Container Conflicts & Port Collisions

**Symptoms**:
- `ninedeploy server start` fails with `port is already allocated` or `Conflict. The container name "/ninedeploy" is already in use`.

**Resolution**:
1. **Port in use**: If another service occupies port 3000, specify a custom port:
   ```bash
   ninedeploy server start --port 3001
   ninedeploy config --server http://localhost:3001
   ```
2. **Container conflict**: Remove stale or orphaned containers:
   ```bash
   docker rm -f ninedeploy
   ninedeploy server start
   ```

---

## 🩺 7. Running Full Health Diagnostics

Whenever encountering unexpected behavior, run the built-in doctor utility:
```bash
ninedeploy doctor
```
This inspects:
- Node.js runtime and architecture
- Docker daemon status and server container state
- NineDeploy HTTP API response and latency
- Local session token validity and user roles

---

## 🧠 8. Docker Pull Exits with Code 143 (Out-of-Memory / OOM Killer)

**Symptoms**:
- Pulling or deploying large Docker images/templates (e.g. `n8nio/n8n`, `supabase`, `postgres`) fails with:
  ```
  ✗ Deployment failed: `docker pull n8nio/n8n` exited with code 143
  ```
- `dmesg -T` logs `Out of memory: Killed process` or kernel OOM killer activity.

**Cause**:
- Unpacking large multi-layer Docker images consumes significant memory and I/O. On low-memory VPS instances (1 GB – 2 GB RAM) without swap space, the Linux kernel terminates the pull process with `SIGTERM` (code 143: 128 + 15).

**Resolution**:
1. **Enable Swap Memory (Recommended)**:
   ```bash
   # Allocate and activate 2 GB - 4 GB swapfile
   sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   
   # Make permanent across reboots
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
2. **Pre-pull the image on host terminal**:
   ```bash
   docker pull <image-name>
   ```
   Once cached locally in Docker Engine, redeploying from the NineDeploy Dashboard will start immediately without pulling.


