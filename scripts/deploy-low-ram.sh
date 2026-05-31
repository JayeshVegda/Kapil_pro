#!/usr/bin/env bash
set -euo pipefail

# Low-RAM deployment for the current Kapil compose + Caddy setup.
# Strategy:
# 1) Build static frontend with Node 24
# 2) Create a local PocketBase data backup before replacing containers
# 3) Remove old compose containers and recreate them
# 4) Verify public app, PocketBase, and market-rate endpoints

APP_DIR="${APP_DIR:-/opt/docker/apps/Kapil_Test}"
DOMAIN="${DOMAIN:-https://kapil-test.zayu.dev}"
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

if [[ -d "pb_data" ]]; then
  BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/logs/deploy-backups}"
  BACKUP_FILE="${BACKUP_DIR}/pb_data_$(date -u +%Y%m%dT%H%M%SZ).zip"
  mkdir -p "${BACKUP_DIR}"
  echo "==> Creating local PocketBase backup: ${BACKUP_FILE}"
  zip -qr "${BACKUP_FILE}" pb_data
fi

echo "==> Removing old compose containers"
docker compose down --remove-orphans

echo "==> Starting compose services"
docker compose up -d

echo "==> Verifying app endpoint"
curl -fsS --max-time 20 "${DOMAIN}" >/dev/null

echo "==> Verifying PocketBase health through domain proxy"
curl -fsS --max-time 20 "${DOMAIN}/pb/api/health" >/dev/null

echo "==> Verifying market-rate proxy"
curl -fsS --max-time 20 "${DOMAIN}/api/market-rate" >/dev/null

echo "Deployment complete: ${DOMAIN}"
