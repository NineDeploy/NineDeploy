# Managed Databases & Backups

NineDeploy provides one-click provisioning and lifecycle management for production-grade databases, plus encrypted snapshots for both databases and attached volumes with offsite cloud storage.

---

## 🗄️ 1. Supported Managed Databases

| Engine | Version / Flavor | Features |
| :--- | :--- | :--- |
| **PostgreSQL** | 16 / 17 + `pgvector` | Full ACID, vector embeddings, relational indexing |
| **MySQL** | 8.0 / 8.4 LTS | High throughput, InnoDB storage |
| **MariaDB** | 11.4 LTS | Community SQL server with columnar support |
| **Redis / Valkey** | 7.x | Low-latency in-memory caching and message pub/sub |
| **MongoDB** | 7.0 Community | Document-oriented NoSQL database |
| **ClickHouse** | Latest | High-performance columnar analytics |
| **Meilisearch** | Latest | Lightning-fast full-text search engine |
| **RabbitMQ** | 3.13 Management | Enterprise message broker with AMQP |

---

## 🔗 2. Connection String Auto-Injection

- When a database is provisioned, NineDeploy generates cryptographically strong random credentials.
- In-memory linkers automatically inject environment variables into linked application services:
  - `DATABASE_URL` (e.g. `postgresql://user:pass@srv-postgres:5432/main`)
  - `REDIS_URL` (e.g. `redis://:pass@srv-redis:6379`)

---

## ☁️ 3. Offsite Backup Destinations

Automated backup jobs run on configurable cron schedules and upload AES-encrypted tar archives to S3-compatible cloud storage:
- **Amazon S3 / AWS GovCloud**
- **Cloudflare R2** (Zero egress fees)
- **MinIO / Self-Hosted S3**
- **Wasabi / DigitalOcean Spaces**

The same destination backs up attached volume snapshots; every archive is sealed with AES-256-GCM as it streams and requests to the destination are egress-gated like all outbound traffic.

---

## 💾 4. Volume Snapshots & Labels

Each managed Docker volume can be snapshotted (`tar.gz`), restored or downloaded from the Volumes tab:

- **Labels**: manual snapshots accept an optional operator label (up to 40 chars, defaulting to `manual`); scheduled runs are labeled `schedule-YYYY-MM-DD`. Labels surface on the Backups page so a mixed database/volume list stays readable.
- **Scheduling**: a recurring job can sweep multiple volumes in one pass, reusing the backup destination for off-site copies.
- **Safe restore**: restores refuse to run while a service is still live on that volume.

---

## 🛡️ 5. Restore & Tar-Slip Safety

- Restores can be initiated via Web UI, CLI (`ninedeploy backups restore`), or MCP tool.
- The decompression engine enforces path validation to prevent **Tar-Slip** vulnerabilities, rejecting any archive entries targeting paths outside the allocated container volume.
