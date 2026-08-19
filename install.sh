#!/usr/bin/env bash
#
# NineDeploy — one-click installer
# https://github.com/NineDeploy/NineDeploy
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/NineDeploy/NineDeploy/main/install.sh | bash
#
# Or from a clone:
#   ./install.sh
#
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

INSTALL_DIR="${NINEDEPLOY_INSTALL_DIR:-$HOME/ninedeploy}"
REPO_URL="https://github.com/NineDeploy/NineDeploy.git"
NEEDS_CLONE=false

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       NineDeploy Installer               ║${NC}"
echo -e "${BOLD}║       Self-hosted PaaS                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Prerequisites ───────────────────────────────────────────────────────

# Base system packages on Debian/Ubuntu
if [ "$(uname -s)" = "Linux" ] && command -v apt-get &>/dev/null; then
  if ! command -v curl &>/dev/null || ! command -v git &>/dev/null || ! command -v tar &>/dev/null; then
    info "Installing base system packages (curl, git, ca-certificates, tar)…"
    sudo apt-get update -y >/dev/null 2>&1 || true
    sudo apt-get install -y curl git ca-certificates tar gzip >/dev/null 2>&1 || true
  fi
fi

# Node.js ≥ 22.13 (pnpm 11 requires node:sqlite)
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  NODE_MINOR=$(node -v | sed 's/v//' | cut -d. -f2)
  if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 13 ]; }; then
    ok "Node.js $(node -v)"
  else
    fail "Node.js $(node -v) — need ≥ 22.13 (pnpm 11 requires node:sqlite). Upgrade: https://nodejs.org/"
  fi
else
  warn "Node.js not found. Installing via NodeSource…"
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v brew &>/dev/null; then
    brew install node@22
  else
    fail "Node.js not found and no supported package manager. Install manually: https://nodejs.org/"
  fi
  ok "Node.js $(node -v) installed"
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Installing pnpm…"
  PNPM_VERSION="11.21.0"
  if [ -f "$INSTALL_DIR/package.json" ]; then
    PNPM_VERSION=$(node -p "require('${INSTALL_DIR}/package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]" 2>/dev/null || echo "11.21.0")
  fi
  (corepack enable 2>/dev/null && corepack prepare "pnpm@${PNPM_VERSION}" --activate 2>/dev/null) || sudo npm install -g "pnpm@${PNPM_VERSION}" || npm install -g "pnpm@${PNPM_VERSION}"
fi
ok "pnpm $(pnpm -v 2>/dev/null || echo 'installed')"

# Docker
if ! command -v docker &>/dev/null; then
  warn "Docker not found. Installing via official script (get.docker.com)…"
  if command -v curl &>/dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
    if command -v systemctl &>/dev/null; then
      sudo systemctl enable --now docker || true
    fi
  else
    warn "Install Docker manually: https://docs.docker.com/engine/install/"
    fail "Docker is required."
  fi
fi
if ! docker info &>/dev/null 2>&1; then
  if command -v systemctl &>/dev/null; then
    warn "Starting Docker service…"
    sudo systemctl start docker || true
  fi
fi
if ! docker info &>/dev/null 2>&1; then
  warn "Docker daemon not running. Start it and re-run."
  fail "Docker daemon must be running."
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# Swap space (Linux)
# Low-memory VPS nodes (<= 4GB RAM) without swap risk OOM-kills when pulling
# or unpacking large Docker images (e.g. n8n, Supabase, Postgres).
if [ "$(uname -s)" = "Linux" ]; then
  SWAP_TOTAL=$(free -m 2>/dev/null | awk '/^Swap:/ {print $2}' || echo "0")
  if [ -n "$SWAP_TOTAL" ] && [ "${SWAP_TOTAL:-0}" -lt 1024 ]; then
    MEM_TOTAL=$(free -m 2>/dev/null | awk '/^Mem:/ {print $2}' || echo "2048")
    if [ "${MEM_TOTAL:-2048}" -le 4096 ]; then
      info "Low swap detected (${SWAP_TOTAL:-0}MB on ${MEM_TOTAL:-2048}MB RAM). Configuring 2GB swapfile for reliable Docker operations…"
      if [ ! -f /swapfile ]; then
        (sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048) 2>/dev/null || true
        sudo chmod 600 /swapfile 2>/dev/null || true
        sudo mkswap /swapfile >/dev/null 2>&1 || true
      fi
      if sudo swapon /swapfile >/dev/null 2>&1; then
        ok "2GB swapfile activated"
        if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
          echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null 2>&1 || true
        fi
      else
        warn "Could not activate swapfile (may be running inside container or non-root) — continuing."
      fi
    fi
  elif [ -n "$SWAP_TOTAL" ] && [ "${SWAP_TOTAL:-0}" -ge 1024 ]; then
    ok "Swap space (${SWAP_TOTAL}MB)"
  fi
fi

# Network & Ingress Prerequisites
info "Preparing Docker network and Traefik proxy…"
docker network create ninedeploy 2>/dev/null || true
docker pull traefik:3 >/dev/null 2>&1 || true

# Free ports 80/443 if default apache2/nginx are occupying them on Linux
if [ "$(uname -s)" = "Linux" ] && command -v systemctl &>/dev/null; then
  if systemctl is-active --quiet apache2 2>/dev/null; then
    warn "Stopping conflicting apache2 service on port 80/443…"
    sudo systemctl stop apache2 2>/dev/null || true
    sudo systemctl disable apache2 2>/dev/null || true
  fi
  if systemctl is-active --quiet nginx 2>/dev/null; then
    warn "Stopping conflicting nginx service on port 80/443…"
    sudo systemctl stop nginx 2>/dev/null || true
    sudo systemctl disable nginx 2>/dev/null || true
  fi
fi
ok "Docker network & ingress ready"

# ── 2. Resolve the version to install ──────────────────────────────────────
#
# Channel:
#   release (default) — latest vX.Y.Z git tag (stable)
#   main              — track the main branch (edge; previous behaviour)
# A specific tag can be pinned with --version vX.Y.Z / NINEDEPLOY_VERSION.

CHANNEL="${NINEDEPLOY_CHANNEL:-release}"
PINNED_VERSION="${NINEDEPLOY_VERSION:-}"

for arg in "$@"; do
  case "$arg" in
    --version=*) PINNED_VERSION="${arg#--version=}" ;;
    --version)   : ;; # value comes as the next arg when passed separately
    --channel=*) CHANNEL="${arg#--channel=}" ;;
    --channel)   : ;;
    v[0-9]*)     [ -z "$PINNED_VERSION" ] && PINNED_VERSION="$arg" ;;
  esac
done

# Highest vX.Y.Z tag from the remote (no clone needed).
latest_tag() {
  git ls-remote --tags --refs "$REPO_URL" 2>/dev/null \
    | awk -F/ '{print $NF}' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V | tail -1
}

REF=""
if [ -n "$PINNED_VERSION" ]; then
  REF="$PINNED_VERSION"
  info "Installing pinned version $REF"
elif [ "$CHANNEL" = "main" ]; then
  REF="main"
  info "Edge channel: tracking the main branch"
else
  REF=$(latest_tag)
  if [ -z "$REF" ]; then
    warn "No release tags found — falling back to the main branch"
    REF="main"
  else
    info "Release channel: installing $REF (latest tag)"
  fi
fi

# ── 3. Get the code ────────────────────────────────────────────────────────

if [ -f "$INSTALL_DIR/package.json" ]; then
  info "Existing installation found at $INSTALL_DIR — updating…"
  cd "$INSTALL_DIR"

  HAS_SYSTEMD=false
  if [ "$(uname -s)" = "Linux" ] && command -v systemctl &>/dev/null && systemctl is-active --quiet ninedeploy 2>/dev/null; then
    HAS_SYSTEMD=true
    info "Stopping the service for a consistent backup…"
    sudo systemctl stop ninedeploy
  fi

  # Safety net before an upgrade: snapshot DB + master key inside the data dir.
  if [ -d .data ]; then
    mkdir -p .data/upgrade-backups
    BACKUP_FILE=".data/upgrade-backups/pre-update-$(date +%Y%m%d-%H%M%S).tar.gz"
    if tar -czf "$BACKUP_FILE" .data/ninedeploy.db .data/master.key 2>/dev/null; then
      ok "Pre-update backup saved to $BACKUP_FILE"
    else
      warn "Backup of .data failed — continuing (git history remains)"
    fi
  fi

  git fetch --tags origin
  git checkout --force "$REF" || { [ "$HAS_SYSTEMD" = true ] && sudo systemctl start ninedeploy; fail "could not check out $REF"; }
  if [ "$REF" = "main" ]; then
    git pull origin main || warn "git pull failed, continuing with the checked-out $REF"
  fi
else
  info "Cloning NineDeploy to $INSTALL_DIR …"
  git clone --depth 1 ${REF:+-b "$REF"} "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── 3. Install + build ────────────────────────────────────────────────────

info "Installing dependencies…"
# Frozen installs keep the committed lockfile authoritative (the same
# discipline CI enforces). Falling back to a non-frozen install would silently
# re-derive dependency edges and reintroduce the deprecated packages the CI
# guard exists to catch — so fail loudly instead.
pnpm install --frozen-lockfile

info "Building…"
pnpm build

# ── 4. Configure ──────────────────────────────────────────────────────────

if [ ! -f ".env" ]; then
  info "Creating .env from template…"
  cp .env.example .env

  # Set production mode
  sed -i.bak "s|^NODE_ENV=.*|NODE_ENV=production|" .env && rm -f .env.bak

  # Generate strong 32-byte hex secrets (64 chars)
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i.bak "s|^NINEDEPLOY_JWT_SECRET=.*|NINEDEPLOY_JWT_SECRET=${JWT_SECRET}|" .env && rm -f .env.bak

  MASTER_KEY=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i.bak "s|^NINEDEPLOY_MASTER_KEY=.*|NINEDEPLOY_MASTER_KEY=${MASTER_KEY}|" .env && rm -f .env.bak

  ok ".env created with generated production secrets"
else
  ok ".env already exists"
fi

mkdir -p .data

info "Running database migrations…"
# Export .env first: drizzle.config reads NINEDEPLOY_DB_PATH/NINEDEPLOY_DATA_DIR
# from the environment, so without this the migrate step could target a
# different database file than the one the service actually runs on.
set -a
# shellcheck disable=SC1091
. ./.env
set +a
pnpm db:migrate

# ── 5. Systemd (Linux) ────────────────────────────────────────────────────

if [ "$(uname -s)" = "Linux" ] && command -v systemctl &>/dev/null; then
  info "Setting up systemd service…"
  # Render the CHECKED-IN hardened unit (systemd/ninedeploy.service) with this
  # install's paths so the installer and the repo unit never drift apart.
  # Placeholders: @NODE@, @INSTALL_DIR@, @DATA_DIR@.
  UNIT_TEMPLATE="$INSTALL_DIR/systemd/ninedeploy.service"
  if [ ! -f "$UNIT_TEMPLATE" ]; then
    fail "systemd/ninedeploy.service not found in the repo — re-run ./install.sh"
  fi
  DATA_DIR="${NINEDEPLOY_DATA_DIR:-$INSTALL_DIR/.data}"
  mkdir -p "$DATA_DIR"
  SERVICE_FILE="/etc/systemd/system/ninedeploy.service"
  sed -e "s|@NODE@|$(which node)|g" \
      -e "s|@INSTALL_DIR@|${INSTALL_DIR}|g" \
      -e "s|@DATA_DIR@|${DATA_DIR}|g" \
      -e "s|@USER@|$(id -un)|g" \
      -e "s|@GROUP@|$(id -gn)|g" \
      "$UNIT_TEMPLATE" | sudo tee "$SERVICE_FILE" > /dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable ninedeploy
  sudo systemctl restart ninedeploy

  # Readiness gate: give the API 60s to answer /health before declaring
  # success — a failed migration or boot crash surfaces here, not later.
  HEALTH_PORT="${NINEDEPLOY_PORT:-3000}"
  info "Waiting for the API to come up (up to 60s)…"
  if command -v curl &>/dev/null; then
    for i in $(seq 1 60); do
      if curl -fsS -m 2 "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then
        ok "NineDeploy service is healthy (systemd, hardened unit)"
        break
      fi
      sleep 1
      if [ "$i" = "60" ]; then
        fail "Service did not become healthy in 60s. Inspect: journalctl -u ninedeploy -n 50 (a pre-update backup is in ${DATA_DIR}/upgrade-backups)"
      fi
    done
  else
    ok "NineDeploy service started (systemd, hardened unit)"
  fi
else
  warn "systemd not available — starting in foreground…"
  info "For production, set up a process manager (systemd/pm2/launchd)."
fi

# ── 6. Print summary ──────────────────────────────────────────────────────

HOST="${NINEDEPLOY_HOST:-0.0.0.0}"
PORT="${NINEDEPLOY_PORT:-3000}"
PUBLIC_URL="${NINEDEPLOY_PUBLIC_URL:-http://localhost:3000}"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       ✓ Installation Complete            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Dashboard:${NC}  ${PUBLIC_URL}"
echo -e "  ${CYAN}API:${NC}       ${PUBLIC_URL}/health"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. Open ${PUBLIC_URL} in your browser"
echo -e "  2. Create your admin account (first-run setup)"
echo -e "  3. Deploy your first service from the Hub or a Git repo"
echo ""
if [ "$(uname -s)" = "Linux" ]; then
  echo -e "  ${CYAN}Manage:${NC}"
  echo -e "  sudo systemctl status ninedeploy"
  echo -e "  sudo systemctl restart ninedeploy"
  echo -e "  journalctl -u ninedeploy -f"
fi
echo ""
echo -e "  ${CYAN}CLI:${NC}"
echo -e "  npx ninedeploy init      # complete initial admin setup"
echo -e "  npx ninedeploy doctor    # run diagnostic check"
echo -e "  npx ninedeploy services list"
echo ""
