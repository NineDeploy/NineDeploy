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

if [ -z "${NINEDEPLOY_INSTALL_DIR:-}" ]; then
  if [ -f "./package.json" ] && [ -d "./apps/server" ]; then
    INSTALL_DIR="$(pwd)"
  elif [ -d "/opt/ninedeploy" ] && [ -f "/opt/ninedeploy/package.json" ]; then
    INSTALL_DIR="/opt/ninedeploy"
  elif [ -d "$HOME/ninedeploy" ]; then
    INSTALL_DIR="$HOME/ninedeploy"
  else
    INSTALL_DIR="$HOME/ninedeploy"
  fi
else
  INSTALL_DIR="$NINEDEPLOY_INSTALL_DIR"
fi
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
    warn "Node.js $(node -v) is older than recommended (≥ 22.13). Upgrading to LTS via NodeSource…"
    if command -v apt-get &>/dev/null; then
      (curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs) || \
      (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs)
      ok "Upgraded Node.js to $(node -v)"
    else
      fail "Node.js $(node -v) — need ≥ 22.13. Upgrade: https://nodejs.org/"
    fi
  fi
else
  warn "Node.js not found. Installing Active LTS via NodeSource…"
  if command -v apt-get &>/dev/null; then
    (curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs) || \
    (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs)
  elif command -v brew &>/dev/null; then
    brew install node@24 2>/dev/null || brew install node@22
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
if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" -ne 0 ]; then
  CURRENT_USER="$(id -un)"
  if ! groups "$CURRENT_USER" 2>/dev/null | grep -q '\bdocker\b'; then
    info "Adding user $CURRENT_USER to docker group…"
    sudo usermod -aG docker "$CURRENT_USER" 2>/dev/null || true
  fi
fi
if ! docker info &>/dev/null 2>&1 && ! sudo docker info &>/dev/null 2>&1; then
  warn "Docker daemon not running. Start it and re-run."
  fail "Docker daemon must be running."
fi
ok "Docker $(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',' || echo 'installed')"

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
if ! docker network inspect ninedeploy >/dev/null 2>&1; then
  docker network create ninedeploy >/dev/null || fail "Could not create the required Docker network 'ninedeploy'"
fi

# A healthy containerd overlayfs store always has this directory alongside
# metadata.db. Some interrupted Docker 29 cleanups leave the metadata database
# behind but remove the physical snapshot root, making every pull/import fail.
# Restore only the missing directory; never remove or rewrite snapshot data.
CONTAINERD_OVERLAY_ROOT="/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs"
CONTAINERD_SNAPSHOT_DIR="$CONTAINERD_OVERLAY_ROOT/snapshots"
DOCKER_STORAGE_DRIVER=$(docker info --format '{{.Driver}}' 2>/dev/null || true)
if [ "$DOCKER_STORAGE_DRIVER" = "overlayfs" ] && [ ! -d "$CONTAINERD_SNAPSHOT_DIR" ]; then
  warn "Docker's containerd overlayfs snapshot directory is missing; restoring the required host directory…"
  sudo install -d -o root -g root -m 0700 "$CONTAINERD_SNAPSHOT_DIR" || fail "Could not restore $CONTAINERD_SNAPSHOT_DIR"
  [ -d "$CONTAINERD_SNAPSHOT_DIR" ] || fail "Containerd snapshot directory is still unavailable after repair"
  ok "Containerd overlayfs snapshot directory restored"
fi

# Docker 29's containerd store can retain a broken Alpine snapshot forever.
# Do not loop, prune, restart Docker, or mutate containerd metadata here. A
# single registry attempt is enough; the verified binary fallback below has no
# dependency on the conflicting Alpine layer.
traefik_image_usable() {
  docker image inspect traefik:3 >/dev/null 2>&1 || return 1
  IMAGE_VERSION=$(docker run --rm traefik:3 version 2>/dev/null || true)
  printf '%s\n' "$IMAGE_VERSION" | grep -Eq 'Version:[[:space:]]+3\.'
}

build_traefik_fallback_image() {
  TRAEFIK_RELEASE="v3.7.11"
  case "$(uname -m)" in
    x86_64|amd64) TRAEFIK_ARCH="amd64" ;;
    aarch64|arm64) TRAEFIK_ARCH="arm64" ;;
    armv7l) TRAEFIK_ARCH="armv7" ;;
    armv6l) TRAEFIK_ARCH="armv6" ;;
    *) warn "No verified Traefik binary fallback is available for architecture $(uname -m)."; return 1 ;;
  esac

  TRAEFIK_ASSET="traefik_${TRAEFIK_RELEASE}_linux_${TRAEFIK_ARCH}.tar.gz"
  TRAEFIK_RELEASE_URL="https://github.com/traefik/traefik/releases/download/${TRAEFIK_RELEASE}"
  TRAEFIK_STAGE=$(mktemp -d) || return 1
  mkdir -p "$TRAEFIK_STAGE/rootfs/etc/ssl/certs" "$TRAEFIK_STAGE/rootfs/tmp" || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  chmod 1777 "$TRAEFIK_STAGE/rootfs/tmp" || { rm -rf "$TRAEFIK_STAGE"; return 1; }

  info "Docker's Alpine snapshot is unusable; building a minimal Traefik ${TRAEFIK_RELEASE} image from the official release assets…"
  curl -fsSL "$TRAEFIK_RELEASE_URL/$TRAEFIK_ASSET" -o "$TRAEFIK_STAGE/$TRAEFIK_ASSET" || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  curl -fsSL "$TRAEFIK_RELEASE_URL/traefik_${TRAEFIK_RELEASE}_checksums.txt" -o "$TRAEFIK_STAGE/checksums.txt" || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  EXPECTED_SHA=$(awk -v asset="$TRAEFIK_ASSET" '$2 == asset { print $1; exit }' "$TRAEFIK_STAGE/checksums.txt")
  ACTUAL_SHA=$(sha256sum "$TRAEFIK_STAGE/$TRAEFIK_ASSET" | awk '{print $1}')
  if [ -z "$EXPECTED_SHA" ] || [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    warn "Traefik release checksum verification failed; refusing to create a local image."
    rm -rf "$TRAEFIK_STAGE"
    return 1
  fi

  tar -xzf "$TRAEFIK_STAGE/$TRAEFIK_ASSET" -C "$TRAEFIK_STAGE" traefik || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  install -m 0755 "$TRAEFIK_STAGE/traefik" "$TRAEFIK_STAGE/rootfs/traefik" || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
    install -m 0644 /etc/ssl/certs/ca-certificates.crt "$TRAEFIK_STAGE/rootfs/etc/ssl/certs/ca-certificates.crt" || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  else
    warn "Host CA certificate bundle is unavailable; refusing to create a TLS proxy image."
    rm -rf "$TRAEFIK_STAGE"
    return 1
  fi

  tar -C "$TRAEFIK_STAGE/rootfs" -cf - . | docker import \
    --change 'ENTRYPOINT ["/traefik"]' \
    --change 'EXPOSE 80 443' \
    --change 'LABEL org.opencontainers.image.source="https://github.com/traefik/traefik"' \
    --change "LABEL org.opencontainers.image.version=\"$TRAEFIK_RELEASE\"" \
    - traefik:3 >/dev/null || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  rm -rf "$TRAEFIK_STAGE"

  LOCAL_TRAEFIK_VERSION=$(docker run --rm traefik:3 version 2>/dev/null || true)
  printf '%s\n' "$LOCAL_TRAEFIK_VERSION" | grep -Eq "Version:[[:space:]]+${TRAEFIK_RELEASE#v}$" || {
    warn "The locally constructed Traefik image failed its version probe."
    return 1
  }
  ok "Verified minimal Traefik ${TRAEFIK_RELEASE} image created without the corrupt Alpine snapshot"
}

if traefik_image_usable; then
  ok "Existing Traefik v3 image verified; skipping registry pull"
else
  if PULL_OUTPUT=$(docker pull traefik:3 2>&1) && traefik_image_usable; then
    printf '%s\n' "$PULL_OUTPUT"
  else
    printf '%s\n' "$PULL_OUTPUT" >&2
    warn "Docker Hub image is unusable; switching immediately to the verified layer-free Traefik image…"
    build_traefik_fallback_image || fail "Could not provision Traefik from Docker Hub or verified upstream release assets; ingress cannot operate"
  fi
fi

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

# Host Firewall (UFW on Linux)
if [ "$(uname -s)" = "Linux" ] && command -v ufw &>/dev/null; then
  info "Configuring host firewall (UFW) with safe defaults…"
  sudo ufw allow 22/tcp comment 'SSH' >/dev/null 2>&1 || true
  sudo ufw allow 80/tcp comment 'HTTP (Traefik)' >/dev/null 2>&1 || true
  sudo ufw allow 443/tcp comment 'HTTPS (Traefik)' >/dev/null 2>&1 || true
  if [ -n "${NINEDEPLOY_PORT:-}" ] && [ "${NINEDEPLOY_PORT:-3000}" != "80" ] && [ "${NINEDEPLOY_PORT:-3000}" != "443" ]; then
    sudo ufw allow "${NINEDEPLOY_PORT}/tcp" comment 'NineDeploy Direct Panel' >/dev/null 2>&1 || true
  fi
  ok "Firewall rules updated (UFW: 22, 80, 443 permitted)"
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version=*)
      PINNED_VERSION="${1#--version=}"
      shift
      ;;
    --version)
      [ "$#" -ge 2 ] || fail "--version requires a vX.Y.Z value"
      PINNED_VERSION="$2"
      shift 2
      ;;
    --channel=*)
      CHANNEL="${1#--channel=}"
      shift
      ;;
    --channel)
      [ "$#" -ge 2 ] || fail "--channel requires release or main"
      CHANNEL="$2"
      shift 2
      ;;
    v[0-9]*)
      [ -z "$PINNED_VERSION" ] && PINNED_VERSION="$1"
      shift
      ;;
    *)
      fail "Unknown installer argument: $1"
      ;;
  esac
done

case "$CHANNEL" in
  release|main) ;;
  *) fail "Unsupported channel '$CHANNEL' (expected release or main)" ;;
esac

if [ -n "$PINNED_VERSION" ] && ! printf '%s' "$PINNED_VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  fail "Invalid version '$PINNED_VERSION' (expected vX.Y.Z)"
fi

# Highest vX.Y.Z tag from the remote (no clone needed).
latest_tag() {
  (git ls-remote --tags --refs "$REPO_URL" 2>/dev/null || true) \
    | awk -F/ '{print $NF}' | (grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true) \
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
pnpm install --frozen-lockfile || pnpm install

info "Building…"
pnpm build

# Link global CLI executable
if [ -f "$INSTALL_DIR/apps/cli/dist/index.js" ]; then
  chmod +x "$INSTALL_DIR/apps/cli/dist/index.js" 2>/dev/null || true
  sudo ln -sf "$INSTALL_DIR/apps/cli/dist/index.js" /usr/local/bin/ninedeploy 2>/dev/null || true
  ok "CLI symlinked to /usr/local/bin/ninedeploy"
fi

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
  DATA_DIR_SETTING="${NINEDEPLOY_DATA_DIR:-$INSTALL_DIR/.data}"
  mkdir -p "$DATA_DIR_SETTING"
  # Environment files commonly use NINEDEPLOY_DATA_DIR=./.data. systemd
  # requires every ReadWritePaths= operand to be absolute, so resolve the
  # configured directory from the installer's current INSTALL_DIR before
  # rendering the unit.
  DATA_DIR=$(cd "$DATA_DIR_SETTING" && pwd -P)
  SERVICE_FILE="/etc/systemd/system/ninedeploy.service"
  UNIT_STAGE_DIR=$(mktemp -d)
  UNIT_STAGE_FILE="$UNIT_STAGE_DIR/ninedeploy.service"
  sed -e "s|@NODE@|$(which node)|g" \
      -e "s|@INSTALL_DIR@|${INSTALL_DIR}|g" \
      -e "s|@DATA_DIR@|${DATA_DIR}|g" \
      -e "s|@USER@|$(id -un)|g" \
      -e "s|@GROUP@|$(id -gn)|g" \
      "$UNIT_TEMPLATE" > "$UNIT_STAGE_FILE"

  # Validate before replacing the live unit. This catches malformed rendered
  # paths without leaving an existing installation unbootable.
  if command -v systemd-analyze &>/dev/null; then
    systemd-analyze verify "$UNIT_STAGE_FILE" >/dev/null || {
      rm -f "$UNIT_STAGE_FILE"
      rmdir "$UNIT_STAGE_DIR"
      fail "Rendered systemd unit is invalid"
    }
  fi
  sudo install -m 0644 "$UNIT_STAGE_FILE" "$SERVICE_FILE"
  rm -f "$UNIT_STAGE_FILE"
  rmdir "$UNIT_STAGE_DIR"

  # Older NineDeploy releases installed Type=notify + WatchdogSec=90. A
  # lingering drop-in can override the new main unit and SIGTERM the server
  # (and its docker pull child) during a long image extraction. Keep this
  # installer-owned, last-applied safety override for both fresh installs and
  # in-place upgrades. User overrides that sort later are detected below.
  RUNTIME_DROPIN_DIR="/etc/systemd/system/ninedeploy.service.d"
  RUNTIME_DROPIN="$RUNTIME_DROPIN_DIR/zzzz-ninedeploy-runtime-safety.conf"
  sudo mkdir -p "$RUNTIME_DROPIN_DIR"
  # v0.2.4 briefly used a numeric prefix which sorts before the conventional
  # override.conf name. Remove only that installer-owned obsolete file; keep
  # every administrator-owned drop-in intact.
  sudo rm -f "$RUNTIME_DROPIN_DIR/99-ninedeploy-runtime-safety.conf"
  printf '%s\n' \
    '# Managed by NineDeploy install.sh — do not enable a service watchdog.' \
    '[Service]' \
    'Type=simple' \
    'WatchdogSec=0' | sudo tee "$RUNTIME_DROPIN" >/dev/null

  sudo systemctl daemon-reload

  EFFECTIVE_TYPE=$(systemctl show ninedeploy --property=Type --value)
  EFFECTIVE_WATCHDOG=$(systemctl show ninedeploy --property=WatchdogUSec --value)
  if [ "$EFFECTIVE_TYPE" != "simple" ]; then
    fail "Unsafe effective systemd Type=$EFFECTIVE_TYPE (expected simple); inspect: systemctl cat ninedeploy"
  fi
  case "$EFFECTIVE_WATCHDOG" in
    0|0us|0ms|0s) ;;
    *) fail "Unsafe effective systemd watchdog $EFFECTIVE_WATCHDOG (expected disabled); inspect: systemctl cat ninedeploy" ;;
  esac
  ok "systemd runtime policy verified (Type=simple, watchdog disabled)"

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

  # /health is only a valid installation gate when the mandatory ingress
  # container is also live on the shared network. Never print a successful
  # installation while domain routing is unavailable.
  TRAEFIK_RUNNING=$(docker inspect ninedeploy-traefik --format '{{.State.Running}}' 2>/dev/null || true)
  TRAEFIK_NETWORKS=$(docker inspect ninedeploy-traefik --format '{{json .NetworkSettings.Networks}}' 2>/dev/null || true)
  if [ "$TRAEFIK_RUNNING" != "true" ] || ! printf '%s' "$TRAEFIK_NETWORKS" | grep -q '"ninedeploy"'; then
    docker logs --tail 50 ninedeploy-traefik 2>&1 || true
    fail "Traefik failed its post-install runtime check; NineDeploy installation is not healthy"
  fi
  ok "Traefik ingress verified (running on the ninedeploy network)"
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
