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
# Deployment modes (the installer follows what is already installed):
#   --docker        panel runs as a Docker container (no Node.js/systemd/PM2
#                   on the host; Docker/Compose deploys, managed databases,
#                   Traefik ingress and S3 backups work identically)
#   --bare-metal    hardened systemd service with direct PM2 access (default
#                   for fresh non-interactive runs)
#   NINEDEPLOY_INSTALL_MODE=docker|bare-metal works too. With no flag, an
#   existing install decides the mode; on a fresh host with a terminal the
#   installer asks. Upgrades are the same command re-run.
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

# ── Remote code policy (L-15) ──────────────────────────────────────────────
#
# This script installs Nixpacks and Traefik by downloading a pinned artifact
# and checking its SHA-256 before use. Docker and Node.js used to be different:
# both were fetched with `curl … | sudo sh`, i.e. whatever bytes the endpoint
# returned were executed as root, unverified, with no record of what ran. A
# compromised CDN, a hijacked domain or an attacker on the path between the
# host and the endpoint got root on the machine that holds every deployment
# secret on this instance.
#
# Those two now install from their vendors' APT repositories, whose packages
# are signed and verified by apt against a key pinned into
# /etc/apt/keyrings — the vendors' own documented method, and the one that
# gives the host a verifiable chain instead of a pipe.
#
# The setup script remains as a last-resort fallback, but it is no longer
# silent: it downloads to a file, prints the URL and the digest of exactly
# what it fetched, and refuses to run without consent.
allow_unverified_scripts() { [ "${NINEDEPLOY_ALLOW_UNVERIFIED_INSTALL_SCRIPTS:-}" = "1" ]; }

# ── Long-step visibility ─────────────────────────────────────────────────────
#
# Vendor installs (Node, Docker) push hundreds of MB through apt with their
# output discarded — from the operator's chair that is indistinguishable from
# a hung installer (a multi-minute "freeze" on a slow mirror). Stream apt's
# own progress lines (Get:/Unpacking/Setting up) live, with a heartbeat when
# nothing matched for a while. The exit code is the wrapped command's own.
run_apt_step() {
  local log offset new printed elapsed rc pid
  log=$(mktemp) || return 1
  offset=1
  elapsed=0
  printed=0
  sudo "$@" >"$log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    new=$(tail -c +"$offset" "$log" | grep -E '^(Get|Hit|Fetched|Unpacking|Setting up|Selecting|Preparing|Need to get)' || true)
    if [ -n "$new" ]; then
      printf '%s\n' "$new"
      offset=$(( $(wc -c <"$log") + 1 ))
      printed=$elapsed
    elif [ $((elapsed - printed)) -ge 20 ]; then
      printf '  … still working (%ss elapsed)\n' "$elapsed" >&2
      printed=$elapsed
    fi
  done
  wait "$pid"
  rc=$?
  new=$(tail -c +"$offset" "$log" | grep -E '^(Get|Hit|Fetched|Unpacking|Setting up|Selecting|Preparing)' || true)
  [ -z "$new" ] || printf '%s\n' "$new"
  if [ "$rc" -ne 0 ]; then
    warn "Command failed: sudo $*"
    tail -n 15 "$log" >&2
  fi
  rm -f "$log"
  return "$rc"
}

# Fetch a vendor GPG key into /etc/apt/keyrings and register its repository.
# Args: <name> <key-url> <repo-line-without-signed-by>
add_signed_apt_repo() {
  local name="$1" key_url="$2" repo_line="$3"
  local keyring="/etc/apt/keyrings/${name}.asc"
  sudo install -m 0755 -d /etc/apt/keyrings || return 1
  curl -fsSL "$key_url" | sudo tee "$keyring" >/dev/null || return 1
  sudo chmod a+r "$keyring" || return 1
  echo "deb [arch=$(dpkg --print-architecture) signed-by=${keyring}] ${repo_line}" \
    | sudo tee "/etc/apt/sources.list.d/${name}.list" >/dev/null || return 1
  run_apt_step apt-get update -y || return 1
}

# Last resort: download a vendor setup script, show what it is, and run it
# only with explicit consent.
run_vendor_script() {
  local url="$1" stage digest
  stage=$(mktemp -d) || fail "Could not create a download workspace"
  curl -fsSL "$url" -o "$stage/setup.sh" || { rm -rf "$stage"; return 1; }
  digest=$(sha256sum "$stage/setup.sh" | awk '{print $1}')
  warn "About to run an UNVERIFIED vendor script as root:"
  warn "  url    : $url"
  warn "  sha256 : $digest"
  if ! allow_unverified_scripts; then
    if [ -t 0 ]; then
      read -r -p "Run it? [y/N] " _reply
      case "$_reply" in [yY]*) ;; *) rm -rf "$stage"; return 1 ;; esac
    else
      warn "Refusing (non-interactive). Re-run with NINEDEPLOY_ALLOW_UNVERIFIED_INSTALL_SCRIPTS=1 to accept."
      rm -rf "$stage"
      return 1
    fi
  fi
  sudo -E bash "$stage/setup.sh"
  local rc=$?
  rm -rf "$stage"
  return $rc
}

# Node.js from NodeSource's signed APT repository.
install_node_apt() {
  local major="$1"
  add_signed_apt_repo "nodesource" \
    "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    "https://deb.nodesource.com/node_${major}.x nodistro main" || return 1
  run_apt_step apt-get install -y nodejs
}

# Node.js: signed repo first, consented script second.
install_node() {
  install_node_apt 24 && return 0
  install_node_apt 22 && return 0
  warn "NodeSource APT repository unavailable — falling back to their setup script."
  (run_vendor_script "https://deb.nodesource.com/setup_24.x" || run_vendor_script "https://deb.nodesource.com/setup_22.x") \
    && sudo apt-get install -y nodejs
}

# Docker from Docker Inc.'s signed APT repository.
install_docker_apt() {
  local codename
  codename=$( (. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") 2>/dev/null ) || return 1
  local id
  id=$( (. /etc/os-release && echo "$ID") 2>/dev/null ) || return 1
  case "$id" in ubuntu|debian) ;; *) return 1 ;; esac
  add_signed_apt_repo "docker" \
    "https://download.docker.com/linux/${id}/gpg" \
    "https://download.docker.com/linux/${id} ${codename} stable" || return 1
  run_apt_step apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

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

# ── 0. Arguments & deployment mode ────────────────────────────────────────

CHANNEL="${NINEDEPLOY_CHANNEL:-release}"
PINNED_VERSION="${NINEDEPLOY_VERSION:-}"
INSTALL_MODE_FLAG=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --docker)
      INSTALL_MODE_FLAG="docker"
      shift
      ;;
    --bare-metal)
      INSTALL_MODE_FLAG="bare-metal"
      shift
      ;;
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

# Deployment mode: explicit flag > env > whatever is already installed. A
# fresh host with a terminal gets asked; piped/non-interactive runs default
# to bare-metal so the documented one-liner keeps its current behaviour.
DOCKER_INSTALL_DIR="${NINEDEPLOY_DOCKER_INSTALL_DIR:-/opt/ninedeploy-docker}"
BARE_METAL_UNIT_FILE="/etc/systemd/system/ninedeploy.service"

bare_metal_present() {
  [ -f "$BARE_METAL_UNIT_FILE" ] && return 0
  # A repo checkout alone is not an install; the installer's own .env plus
  # data directory are the footprint it leaves behind on this machine.
  [ -f "$INSTALL_DIR/package.json" ] && [ -f "$INSTALL_DIR/.env" ] && [ -d "$INSTALL_DIR/.data" ] && return 0
  return 1
}

docker_install_present() { [ -f "$DOCKER_INSTALL_DIR/docker-compose.yml" ]; }

if [ -n "$INSTALL_MODE_FLAG" ]; then
  INSTALL_MODE="$INSTALL_MODE_FLAG"
elif [ -n "${NINEDEPLOY_INSTALL_MODE:-}" ]; then
  INSTALL_MODE="$NINEDEPLOY_INSTALL_MODE"
elif bare_metal_present; then
  INSTALL_MODE="bare-metal"
elif docker_install_present; then
  INSTALL_MODE="docker"
elif [ -t 0 ]; then
  echo "Deployment mode:"
  echo "  1) Docker container   — panel runs as a container; no Node.js/PM2/systemd on the host"
  echo "  2) Bare-metal systemd — full feature set incl. PM2 services and UFW management"
  read -r -p "Choose [1/2, Enter=2]: " _mode_reply
  case "$_mode_reply" in
    1) INSTALL_MODE="docker" ;;
    *) INSTALL_MODE="bare-metal" ;;
  esac
else
  INSTALL_MODE="bare-metal"
fi

case "$INSTALL_MODE" in
  docker|bare-metal) ;;
  *) fail "Unsupported install mode '$INSTALL_MODE' (expected docker or bare-metal)" ;;
esac

if [ "$INSTALL_MODE" = "docker" ] && bare_metal_present; then
  fail "A bare-metal installation is already present. Upgrade it in place (re-run without --docker) or uninstall it first — running both would fight over the same ports and the Traefik ingress."
fi
ok "Deployment mode: $INSTALL_MODE"

# ── 1. Prerequisites ───────────────────────────────────────────────────────

# Base system packages on Debian/Ubuntu
if [ "$(uname -s)" = "Linux" ] && command -v apt-get &>/dev/null; then
  if ! command -v curl &>/dev/null || ! command -v git &>/dev/null || ! command -v tar &>/dev/null || ! command -v sha256sum &>/dev/null; then
    info "Installing base system packages (curl, git, ca-certificates, tar, coreutils)…"
    run_apt_step apt-get update -y || true
    run_apt_step apt-get install -y curl git ca-certificates tar gzip coreutils || true
  fi
fi

# Node.js, pnpm and the host Nixpacks CLI drive bare-metal builds and PM2
# services. In Docker mode the panel container bundles its own Node runtime
# and Nixpacks, so none of these are needed on the host.
if [ "$INSTALL_MODE" != "docker" ]; then

# Node.js ≥ 22.13 (pnpm 11 requires node:sqlite)
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  NODE_MINOR=$(node -v | sed 's/v//' | cut -d. -f2)
  if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 13 ]; }; then
    ok "Node.js $(node -v)"
  else
    warn "Node.js $(node -v) is older than recommended (≥ 22.13). Upgrading to LTS via NodeSource…"
    if command -v apt-get &>/dev/null; then
      install_node || fail "Could not upgrade Node.js. Install >= 22.13 manually: https://nodejs.org/"
      ok "Upgraded Node.js to $(node -v)"
    else
      fail "Node.js $(node -v) — need ≥ 22.13. Upgrade: https://nodejs.org/"
    fi
  fi
else
  warn "Node.js not found. Installing Active LTS via NodeSource…"
  info "This downloads the NodeSource repository and the Node.js package — a few minutes on slow mirrors. Progress lines follow."
  if command -v apt-get &>/dev/null; then
    install_node || fail "Could not install Node.js. Install >= 22.13 manually: https://nodejs.org/"
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
  PNPM_VERSION="11.23.0"
  if [ -f "$INSTALL_DIR/package.json" ]; then
    PNPM_VERSION=$(node -p "require('${INSTALL_DIR}/package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]" 2>/dev/null || echo "11.23.0")
  fi
  (corepack enable 2>/dev/null && corepack prepare "pnpm@${PNPM_VERSION}" --activate 2>/dev/null) || sudo npm install -g "pnpm@${PNPM_VERSION}" || npm install -g "pnpm@${PNPM_VERSION}"
fi
ok "pnpm $(pnpm -v 2>/dev/null || echo 'installed')"

# Nixpacks CLI — required for source repositories without a Dockerfile.
# ghcr.io/railwayapp/nixpacks is a build base image, not a runnable CLI image,
# so install the pinned upstream binary and verify it before exposing it.
#
# Override at install time with: NINEDEPLOY_NIXPACKS_VERSION=1.40.0 ./install.sh
# The table below only carries checksums for versions we know about; an unknown
# version is rejected rather than silently fetched (defence-in-depth against
# tampered release artefacts). To add a new release, drop its checksums in
# here from the official GitHub release page.
NIXPACKS_VERSION="${NINEDEPLOY_NIXPACKS_VERSION:-1.41.0}"

# Nixpacks → SHA-256 (per arch: <version>:<arch>:<sha256>).
# Source: https://github.com/railwayapp/nixpacks/releases — every entry below
# was cross-checked against the GitHub-published `sha256sum -c *.sha256`.
NIXPACKS_SHA_AMD64_x86_64="0f55de7874507b9cf7502113120bd96f2ab6979f78d10eaf2eb2ade9207b3af6"
NIXPACKS_SHA_ARM64_aarch64="912bd02dd2bb6f9c3a9ed965fe8a68b4aa318dc7a2546e2eca6f2806a894ba39"

install_nixpacks() {
  case "$(uname -m)" in
    x86_64|amd64)
      NIXPACKS_TARGET="x86_64-unknown-linux-musl"
      NIXPACKS_SHA256="$NIXPACKS_SHA_AMD64_x86_64"
      ;;
    aarch64|arm64)
      NIXPACKS_TARGET="aarch64-unknown-linux-musl"
      NIXPACKS_SHA256="$NIXPACKS_SHA_ARM64_aarch64"
      ;;
    *) fail "Nixpacks ${NIXPACKS_VERSION} has no verified binary for architecture $(uname -m)" ;;
  esac

  if [ -z "$NIXPACKS_SHA256" ]; then
    fail "Nixpacks ${NIXPACKS_VERSION} is not in the installer's verified-checksum table. Set NIXPACKS_VERSION to a known release, or update the SHA table in install.sh after auditing the GitHub release."
  fi

  NIXPACKS_ASSET="nixpacks-v${NIXPACKS_VERSION}-${NIXPACKS_TARGET}.tar.gz"
  NIXPACKS_STAGE=$(mktemp -d) || fail "Could not create Nixpacks installation workspace"
  curl -fsSL "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/${NIXPACKS_ASSET}" \
    -o "$NIXPACKS_STAGE/$NIXPACKS_ASSET" || { rm -rf "$NIXPACKS_STAGE"; fail "Could not download Nixpacks ${NIXPACKS_VERSION}"; }
  NIXPACKS_ACTUAL_SHA=$(sha256sum "$NIXPACKS_STAGE/$NIXPACKS_ASSET" | awk '{print $1}')
  if [ "$NIXPACKS_ACTUAL_SHA" != "$NIXPACKS_SHA256" ]; then
    rm -rf "$NIXPACKS_STAGE"
    fail "Nixpacks checksum verification failed; refusing to install an unverified build tool"
  fi
  tar -xzf "$NIXPACKS_STAGE/$NIXPACKS_ASSET" -C "$NIXPACKS_STAGE" nixpacks || { rm -rf "$NIXPACKS_STAGE"; fail "Could not extract Nixpacks"; }
  sudo install -m 0755 "$NIXPACKS_STAGE/nixpacks" /usr/local/bin/nixpacks || { rm -rf "$NIXPACKS_STAGE"; fail "Could not install Nixpacks"; }
  rm -rf "$NIXPACKS_STAGE"
}

if command -v nixpacks &>/dev/null && nixpacks --version 2>/dev/null | grep -q "${NIXPACKS_VERSION}"; then
  ok "Nixpacks $(nixpacks --version 2>/dev/null)"
else
  info "Installing checksum-verified Nixpacks ${NIXPACKS_VERSION} for source builds…"
  install_nixpacks
  nixpacks --version 2>/dev/null | grep -q "${NIXPACKS_VERSION}" || fail "Nixpacks installation verification failed"
  ok "Nixpacks $(nixpacks --version 2>/dev/null)"
fi

fi # end bare-metal-only prerequisites (Node, pnpm, Nixpacks)

# Docker
if ! command -v docker &>/dev/null; then
  if ! command -v curl &>/dev/null; then
    warn "Install Docker manually: https://docs.docker.com/engine/install/"
    fail "Docker is required."
  fi
  info "Docker not found. Installing Docker Engine + containerd from the signed APT repository…"
  info "This is the largest download of the install (~150 MB) and can take several minutes. Progress lines follow."
  if command -v apt-get &>/dev/null && install_docker_apt; then
    ok "Installed Docker from Docker Inc.'s signed APT repository"
  else
    warn "Docker APT repository unavailable — falling back to get.docker.com."
    run_vendor_script "https://get.docker.com" \
      || fail "Docker is required. Install it manually: https://docs.docker.com/engine/install/"
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
if docker info &>/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo docker info &>/dev/null 2>&1; then
  # A just-added docker group is not visible in the current shell. Keep this
  # one installer run reliable; the systemd service starts with its own groups.
  DOCKER=(sudo docker)
else
  warn "Docker daemon not running. Start it and re-run."
  fail "Docker daemon must be running."
fi
docker_cmd() { "${DOCKER[@]}" "$@"; }
ok "Docker $(docker_cmd --version 2>/dev/null | awk '{print $3}' | tr -d ',' || echo 'installed')"

# Boot resilience: a Docker daemon that is merely running NOW but not enabled
# in systemd silently stays down after the next reboot. Docker's restart
# policies then never fire, so Traefik and every deployed container stay dead,
# and the NineDeploy unit (Requires=docker.service) goes down with them. Ensure
# boot enablement unconditionally — including when this installer did not
# install Docker itself.
if [ "$(uname -s)" = "Linux" ] && command -v systemctl &>/dev/null; then
  sudo systemctl enable docker.service >/dev/null 2>&1 || true
  sudo systemctl enable docker.socket >/dev/null 2>&1 || true
  sudo systemctl enable containerd.service >/dev/null 2>&1 || true
  if systemctl is-enabled --quiet docker.service 2>/dev/null \
    || systemctl is-enabled --quiet docker.socket 2>/dev/null; then
    ok "Docker is enabled at boot (systemd)"
  else
    # Not a hard failure: snap-managed or socket-activated Docker installs can
    # be boot-persistent without these exact unit names. Warn loudly instead.
    warn "Could not verify Docker boot enablement via systemd units."
    warn "If Docker is not managed by snap, run: sudo systemctl enable docker.service"
  fi
fi

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
if ! docker_cmd network inspect ninedeploy >/dev/null 2>&1; then
  docker_cmd network create ninedeploy >/dev/null || fail "Could not create the required Docker network 'ninedeploy'"
fi

# A healthy containerd overlayfs store always has this directory alongside
# metadata.db. Some interrupted Docker 29 cleanups leave the metadata database
# behind but remove the physical snapshot root, making every pull/import fail.
# Restore only the missing directory; never remove or rewrite snapshot data.
if [ -S /var/run/docker/containerd/containerd.sock ]; then
  CONTAINERD_OVERLAY_ROOT="/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs"
else
  CONTAINERD_OVERLAY_ROOT="/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs"
fi
CONTAINERD_SNAPSHOT_DIR="$CONTAINERD_OVERLAY_ROOT/snapshots"
DOCKER_STORAGE_DRIVER=$(docker_cmd info --format '{{.Driver}}' 2>/dev/null || true)
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
  docker_cmd image inspect traefik:3 >/dev/null 2>&1 || return 1
  IMAGE_VERSION=$(docker_cmd run --rm traefik:3 version 2>/dev/null || true)
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

  tar -C "$TRAEFIK_STAGE/rootfs" -cf - . | docker_cmd import \
    --change 'ENTRYPOINT ["/traefik"]' \
    --change 'EXPOSE 80 443' \
    --change 'LABEL org.opencontainers.image.source="https://github.com/traefik/traefik"' \
    --change "LABEL org.opencontainers.image.version=\"$TRAEFIK_RELEASE\"" \
    - traefik:3 >/dev/null || { rm -rf "$TRAEFIK_STAGE"; return 1; }
  rm -rf "$TRAEFIK_STAGE"

  LOCAL_TRAEFIK_VERSION=$(docker_cmd run --rm traefik:3 version 2>/dev/null || true)
  printf '%s\n' "$LOCAL_TRAEFIK_VERSION" | grep -Eq "Version:[[:space:]]+${TRAEFIK_RELEASE#v}$" || {
    warn "The locally constructed Traefik image failed its version probe."
    return 1
  }
  ok "Verified minimal Traefik ${TRAEFIK_RELEASE} image created without the corrupt Alpine snapshot"
}

if traefik_image_usable; then
  ok "Existing Traefik v3 image verified; skipping registry pull"
else
  # The pull output is captured (printed after completion on success), so say
  # what is happening during the silent ~100 MB download window.
  info "Pulling the Traefik v3 image (~100 MB) — output follows when it finishes…"
  if PULL_OUTPUT=$(docker_cmd pull traefik:3 2>&1) && traefik_image_usable; then
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

# ── 2b. Docker mode: deploy the panel as a container and finish ──────────
#
# Everything above is shared with bare-metal (Docker daemon, boot enablement,
# swap, the ninedeploy network, the Traefik image, port and firewall prep).
# From here the modes diverge: Docker mode never clones, builds or installs
# systemd units — it fetches the pinned compose file, maintains a 0600 .env
# next to it, and lets compose own the lifecycle. Re-running the installer
# in this mode IS the upgrade path (same volume, same secrets).
install_docker_mode() {
  # Compose v2 ships with the signed Docker APT repo this installer uses,
  # but a pre-existing Docker install may lack the plugin.
  if ! docker_cmd compose version >/dev/null 2>&1; then
    info "Docker Compose v2 plugin missing — installing docker-compose-plugin…"
    run_apt_step apt-get install -y docker-compose-plugin \
      || fail "Docker Compose v2 is required for the Docker install mode. Install 'docker-compose-plugin' and re-run."
  fi

  # Install dir owned by the invoking user, so .env and compose state stay
  # manageable without sudo (root invocations keep root ownership).
  if [ "$(id -u)" -ne 0 ]; then
    sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0755 "$DOCKER_INSTALL_DIR" \
      || fail "Could not create $DOCKER_INSTALL_DIR"
  else
    install -d -m 0755 "$DOCKER_INSTALL_DIR" || fail "Could not create $DOCKER_INSTALL_DIR"
  fi

  # Compose file for $REF: prefer a checkout the installer was run from,
  # otherwise fetch exactly this file from the same origin as install.sh.
  if [ -f "./docker-compose.prod.yml" ] && [ -f "./package.json" ]; then
    info "Using docker-compose.prod.yml from the current checkout"
    cp ./docker-compose.prod.yml "$DOCKER_INSTALL_DIR/docker-compose.yml.new" \
      || fail "Could not stage the compose file"
  else
    info "Fetching docker-compose.prod.yml for $REF…"
    curl -fsSL "https://raw.githubusercontent.com/NineDeploy/NineDeploy/${REF}/docker-compose.prod.yml" \
      -o "$DOCKER_INSTALL_DIR/docker-compose.yml.new" \
      || fail "Could not fetch docker-compose.prod.yml for $REF"
  fi
  grep -q '^services:' "$DOCKER_INSTALL_DIR/docker-compose.yml.new" \
    || fail "The fetched compose file does not look right (missing 'services:') — refusing to deploy it"
  mv "$DOCKER_INSTALL_DIR/docker-compose.yml.new" "$DOCKER_INSTALL_DIR/docker-compose.yml"

  cd "$DOCKER_INSTALL_DIR"

  # .env: created 0600, then upserted per run. The JWT secret survives
  # upgrades (rotating it would invalidate every session); DOCKER_GID is
  # refreshed every run because the host's docker group id can change.
  gen_secret() {
    if command -v openssl &>/dev/null; then openssl rand -hex 32
    else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
  }
  upsert_env() { # <key> <value>
    if [ -f .env ] && grep -q "^$1=" .env; then
      sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
    else
      printf '%s=%s\n' "$1" "$2" >> .env
    fi
  }
  local old_umask jwt_secret docker_gid
  old_umask=$(umask)
  umask 077
  [ -f .env ] || touch .env
  jwt_secret="$(sed -n 's/^NINEDEPLOY_JWT_SECRET=//p' .env | tail -1)"
  [ -n "${NINEDEPLOY_JWT_SECRET:-}" ] && jwt_secret="$NINEDEPLOY_JWT_SECRET"
  [ -z "$jwt_secret" ] && jwt_secret="$(gen_secret)"
  docker_gid="$(getent group docker | cut -d: -f3)"
  [ -n "$docker_gid" ] || fail "Could not resolve the host docker group id (getent group docker)"
  upsert_env NINEDEPLOY_JWT_SECRET "$jwt_secret"
  upsert_env DOCKER_GID "$docker_gid"
  upsert_env NINEDEPLOY_PORT "${NINEDEPLOY_PORT:-3000}"
  # Optional integrations: written only when provided by the environment and
  # never overwritten once present, so operator edits survive upgrades.
  for _var in NINEDEPLOY_PUBLIC_URL NINEDEPLOY_ACME_EMAIL NINEDEPLOY_DNS_PROVIDER NINEDEPLOY_DNS_TOKEN; do
    _val="${!_var:-}"
    if [ -n "$_val" ] && ! grep -q "^${_var}=" .env; then
      printf '%s=%s\n' "$_var" "$_val" >> .env
    fi
  done
  grep -q '^NINEDEPLOY_PUBLIC_URL=' .env \
    || upsert_env NINEDEPLOY_PUBLIC_URL "http://$(hostname 2>/dev/null || echo localhost):${NINEDEPLOY_PORT:-3000}"
  chmod 600 .env
  umask "$old_umask"

  info "Pulling the NineDeploy panel image (a few hundred MB on first run)…"
  docker_cmd compose pull \
    || fail "Image pull failed — check registry connectivity and re-run the installer."
  docker_cmd compose up -d \
    || { docker_cmd compose logs --tail 50 2>/dev/null || true; fail "docker compose up failed"; }

  HEALTH_PORT="$(sed -n 's/^NINEDEPLOY_PORT=//p' .env | tail -1)"
  HEALTH_PORT="${HEALTH_PORT:-3000}"
  info "Waiting for the panel to become healthy (up to 120s)…"
  _healthy=false
  for _i in $(seq 1 120); do
    if curl -fsS -m 2 "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then _healthy=true; break; fi
    sleep 1
  done
  if [ "$_healthy" != "true" ]; then
    docker_cmd compose logs --tail 50 2>/dev/null || true
    fail "Panel did not become healthy in 120s — inspect: cd $DOCKER_INSTALL_DIR && docker compose logs -f"
  fi
  ok "NineDeploy panel is healthy (docker compose project 'ninedeploy')"

  PUBLIC_URL="$(sed -n 's/^NINEDEPLOY_PUBLIC_URL=//p' .env | tail -1)"
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║       ✓ Installation Complete            ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}Dashboard:${NC}  ${PUBLIC_URL:-http://localhost:${HEALTH_PORT}}"
  echo -e "  ${CYAN}Mode:${NC}       Docker container (compose project 'ninedeploy', restart: unless-stopped)"
  echo -e "  ${CYAN}Directory:${NC}  $DOCKER_INSTALL_DIR (secrets in .env, mode 0600)"
  echo ""
  echo -e "  ${YELLOW}Manage:${NC}"
  echo -e "    cd $DOCKER_INSTALL_DIR && docker compose logs -f"
  echo -e "    docker compose restart"
  echo -e "    docker compose down        # data volume survives"
  echo -e "  ${YELLOW}Upgrade:${NC} re-run this installer (it auto-detects the Docker install), or"
  echo -e "    cd $DOCKER_INSTALL_DIR && docker compose pull && docker compose up -d"
  echo ""
}

if [ "$INSTALL_MODE" = "docker" ]; then
  install_docker_mode
  exit 0
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
  # Tighten the umask BEFORE the file exists: `cp` then `chmod 600` at the end
  # leaves the generated JWT secret and master key world-readable (default
  # umask 022) for the duration of the sed passes below. `sed -i` also creates
  # its temp file under the same umask.
  _nd_old_umask=$(umask)
  umask 077
  cp .env.example .env

  # Set production mode
  sed -i.bak "s|^NODE_ENV=.*|NODE_ENV=production|" .env && rm -f .env.bak

  # Generate strong 32-byte hex secrets (64 chars)
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i.bak "s|^NINEDEPLOY_JWT_SECRET=.*|NINEDEPLOY_JWT_SECRET=${JWT_SECRET}|" .env && rm -f .env.bak

  MASTER_KEY=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i.bak "s|^NINEDEPLOY_MASTER_KEY=.*|NINEDEPLOY_MASTER_KEY=${MASTER_KEY}|" .env && rm -f .env.bak

  chmod 600 .env
  umask "$_nd_old_umask"

  ok ".env created with generated production secrets"
else
  chmod 600 .env
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
if [ -z "${NINEDEPLOY_ACME_EMAIL:-}" ]; then
  ACME_INPUT=""
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf "Let's Encrypt account email (required for automatic HTTPS; Enter to configure later): " > /dev/tty
    IFS= read -r ACME_INPUT < /dev/tty || ACME_INPUT=""
  fi
  if [ -n "$ACME_INPUT" ] && printf '%s' "$ACME_INPUT" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
    sed -i.bak "s|^NINEDEPLOY_ACME_EMAIL=.*|NINEDEPLOY_ACME_EMAIL=${ACME_INPUT}|" .env && rm -f .env.bak
    export NINEDEPLOY_ACME_EMAIL="$ACME_INPUT"
    ok "Automatic HTTPS configured for $ACME_INPUT"
  else
    [ -z "$ACME_INPUT" ] || warn "The supplied ACME email is invalid and was not saved."
    warn "Automatic HTTPS is not active yet: set the Let's Encrypt account email in Settings -> Security after signing in. NineDeploy will apply it to Traefik immediately."
  fi
fi
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
      -e "s|@USER@|root|g" \
      -e "s|@GROUP@|root|g" \
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
    # Modern systemd (v240+) reports a DISABLED watchdog as "infinity", not
    # "0" — most visibly on never-started units during fresh installs. Both
    # spellings mean "will never fire": accept them, reject real intervals.
    0|0us|0ms|0s|infinity|infinityus) ;;
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
  TRAEFIK_RUNNING=$(docker_cmd inspect ninedeploy-traefik --format '{{.State.Running}}' 2>/dev/null || true)
  TRAEFIK_NETWORKS=$(docker_cmd inspect ninedeploy-traefik --format '{{json .NetworkSettings.Networks}}' 2>/dev/null || true)
  if [ "$TRAEFIK_RUNNING" != "true" ] || ! printf '%s' "$TRAEFIK_NETWORKS" | grep -q '"ninedeploy"'; then
    docker_cmd logs --tail 50 ninedeploy-traefik 2>&1 || true
    fail "Traefik failed its post-install runtime check; NineDeploy installation is not healthy"
  fi
  TRAEFIK_HTTP_STATUS=$(curl -sS -o /dev/null -m 5 -w '%{http_code}' -H 'Host: ninedeploy-install-check.invalid' http://127.0.0.1/ 2>/dev/null || true)
  case "$TRAEFIK_HTTP_STATUS" in
    2??|3??|4??) ;;
    *) docker_cmd logs --tail 50 ninedeploy-traefik 2>&1 || true; fail "Traefik is running but its HTTP entrypoint on :80 is not responding" ;;
  esac
  ok "Traefik ingress verified (network attached, :80 responding)"

  # PM2 boot resurrection: bare-metal deployments live in a PM2 daemon that
  # dies with every reboot — and with the panel restart above. The server
  # keeps /root/.pm2/dump.pm2 fresh after each lifecycle change; this unit
  # restores that dump at boot. It is a clean no-op until the first PM2
  # deployment writes a dump (ConditionPathExists).
  PM2_UNIT_TEMPLATE="$INSTALL_DIR/systemd/ninedeploy-pm2.service"
  PM2_CLI="$INSTALL_DIR/apps/server/node_modules/pm2/bin/pm2"
  if [ -f "$PM2_UNIT_TEMPLATE" ] && [ -f "$PM2_CLI" ]; then
    PM2_STAGE_DIR=$(mktemp -d)
    sed -e "s|@NODE@|$(which node)|g" \
        -e "s|@INSTALL_DIR@|${INSTALL_DIR}|g" \
        -e "s|@PM2_HOME@|/root/.pm2|g" \
        "$PM2_UNIT_TEMPLATE" > "$PM2_STAGE_DIR/ninedeploy-pm2.service"
    if ! command -v systemd-analyze &>/dev/null \
      || systemd-analyze verify "$PM2_STAGE_DIR/ninedeploy-pm2.service" >/dev/null 2>&1; then
      sudo install -m 0644 "$PM2_STAGE_DIR/ninedeploy-pm2.service" /etc/systemd/system/ninedeploy-pm2.service
      sudo systemctl daemon-reload
      sudo systemctl enable ninedeploy-pm2 >/dev/null 2>&1 || true
      # Also runs right now: on upgrades the panel restart above killed the
      # PM2 daemon's processes, and resurrect brings them straight back.
      sudo systemctl start ninedeploy-pm2 >/dev/null 2>&1 || true
      if systemctl is-failed --quiet ninedeploy-pm2 2>/dev/null; then
        sudo systemctl reset-failed ninedeploy-pm2 >/dev/null 2>&1 || true
        warn "PM2 resurrect unit failed to run; inspect: journalctl -u ninedeploy-pm2 -n 30"
      else
        ok "PM2 deployments are restored at boot (ninedeploy-pm2.service)"
      fi
    else
      warn "Rendered ninedeploy-pm2 unit failed verification; PM2 deployments will not auto-restore at boot"
    fi
    rm -rf "$PM2_STAGE_DIR"
  else
    warn "PM2 CLI or unit template not found; bare-metal deployments will not auto-restore at boot"
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
