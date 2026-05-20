#!/usr/bin/env bash
set -euo pipefail

# Low-RAM deployment for the current Kapil compose + Caddy setup.
# Strategy:
# 1) Build static frontend with Node 24
# 2) Keep nginx/PocketBase containers managed by docker compose
# 3) Restart nginx so mounted config/header changes are loaded
# 4) Verify public app, PocketBase, and market-rate endpoints

APP_DIR="${APP_DIR:-/opt/docker/apps/Kapil_Pro}"
DOMAIN="${DOMAIN:-https://kapil.zayu.dev}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/home/ubuntu/.nvm/versions/node/v24.15.0/bin}"

cd "${APP_DIR}"

if [[ -d "${NODE_BIN_DIR}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi

echo "==> Using node: $(node -v) ($(command -v node))"
echo "==> Installing dependencies if needed"
npm ci --prefer-offline

echo "==> Building static frontend"
npm run build

echo "==> Ensuring compose services are running"
docker compose up -d

echo "==> Reloading web container config"
docker compose restart kapil >/dev/null

echo "==> Verifying app endpoint"
curl -fsS --max-time 20 "${DOMAIN}" >/dev/null

echo "==> Verifying PocketBase health through domain proxy"
curl -fsS --max-time 20 "${DOMAIN}/pb/api/health" >/dev/null

echo "==> Verifying market-rate proxy"
curl -fsS --max-time 20 "${DOMAIN}/api/market-rate" >/dev/null

echo "Deployment complete: ${DOMAIN}"
