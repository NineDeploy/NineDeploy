#!/usr/bin/env bash
#
# NineDeploy — one-click installer
# https://github.com/ninedeploy/ninedeploy
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ninedeploy/ninedeploy/main/install.sh | bash
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
REPO_URL="https://github.com/ninedeploy/ninedeploy.git"
BRANCH="main"
NEEDS_CLONE=false

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       NineDeploy Installer               ║${NC}"
echo -e "${BOLD}║       Self-hosted PaaS                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Prerequisites ───────────────────────────────────────────────────────

# Node.js ≥ 20
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge 20 ]; then
    ok "Node.js $(node -v)"
  else
    fail "Node.js $(node -v) — need ≥ 20. Upgrade: https://nodejs.org/"
  fi
else
  warn "Node.js not found. Installing via NodeSource…"
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v brew &>/dev/null; then
    brew install node@20
  else
    fail "Node.js not found and no supported package manager. Install manually: https://nodejs.org/"
  fi
  ok "Node.js $(node -v) installed"
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Enabling via corepack…"
  corepack enable
  corepack prepare pnpm@latest --activate
fi
ok "pnpm $(pnpm -v)"

# Docker
if ! command -v docker &>/dev/null; then
  warn "Docker not found. Install it: https://docs.docker.com/engine/install/"
  warn "After installing Docker, re-run this script."
  fail "Docker is required."
fi
if ! docker info &>/dev/null 2>&1; then
  warn "Docker daemon not running. Start it and re-run."
  fail "Docker daemon must be running."
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 2. Get the code ────────────────────────────────────────────────────────

if [ -f "$INSTALL_DIR/package.json" ]; then
  info "Existing installation found at $INSTALL_DIR — updating…"
  cd "$INSTALL_DIR"
  git pull origin "$BRANCH" || warn "git pull failed, continuing with existing code"
else
  info "Cloning NineDeploy to $INSTALL_DIR …"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── 3. Install + build ────────────────────────────────────────────────────

info "Installing dependencies…"
pnpm install --frozen-lockfile || pnpm install

info "Building…"
pnpm build

# ── 4. Configure ──────────────────────────────────────────────────────────

if [ ! -f ".env" ]; then
  info "Creating .env from template…"
  cp .env.example .env

  # Generate a strong JWT secret
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i.bak "s|NINEDEPLOY_JWT_SECRET=.*|NINEDEPLOY_JWT_SECRET=${JWT_SECRET}|" .env && rm -f .env.bak
  ok ".env created with generated secrets"
else
  ok ".env already exists"
fi

mkdir -p .data

info "Running database migrations…"
pnpm db:migrate

# ── 5. Systemd (Linux) ────────────────────────────────────────────────────

if [ "$(uname -s)" = "Linux" ] && command -v systemctl &>/dev/null; then
  info "Setting up systemd service…"
  SERVICE_FILE="/etc/systemd/system/ninedeploy.service"
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=NineDeploy — Self-hosted PaaS
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=$(which node) ${INSTALL_DIR}/apps/server/dist/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable ninedeploy
  sudo systemctl restart ninedeploy
  ok "NineDeploy service started (systemd)"
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
echo -e "  npx ninedeploy setup    # create admin via CLI"
echo -e "  npx ninedeploy services list"
echo ""
