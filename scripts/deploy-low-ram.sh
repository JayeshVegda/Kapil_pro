#!/usr/bin/env bash
set -euo pipefail

# Low-RAM deployment for the current Kapil compose + Caddy setup.
# Strategy:
# 1) Build static frontend with Node 24
# 2) Create a local PocketBase data backup before replacing containers
# 3) Remove old compose containers and recreate them
# 4) Verify public app, PocketBase, and market-rate endpoints

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

APP_DIR="${APP_DIR:-${REPO_DIR}}"
DOMAIN="${DOMAIN:-https://kapil-test.zayu.dev}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/home/ubuntu/.nvm/versions/node/v24.15.0/bin}"
DOPPLER_PROJECT="${DOPPLER_PROJECT:-kapil-billing}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"

if [[ "${KAPIL_SKIP_DOPPLER:-}" != "1" && "${KAPIL_DOPPLER_WRAPPED:-}" != "1" && -z "${PB_ADMIN_PASSWORD:-}" ]]; then
  if command -v doppler >/dev/null 2>&1; then
    echo "==> Re-running deploy with Doppler secrets (${DOPPLER_PROJECT}/${DOPPLER_CONFIG})"
    export KAPIL_DOPPLER_WRAPPED=1
    exec doppler run --project "${DOPPLER_PROJECT}" --config "${DOPPLER_CONFIG}" -- "$0" "$@"
  fi
fi

cd "${APP_DIR}"

if [[ -d "${NODE_BIN_DIR}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi

echo "==> Using node: $(node -v) ($(command -v node))"
echo "==> Installing dependencies if needed"
npm ci --prefer-offline

echo "==> Building static frontend"
npm run build

PB_DATA_DIR=""
if [[ -d "data" ]]; then
  PB_DATA_DIR="data"
elif [[ -d "pb_data" ]]; then
  PB_DATA_DIR="pb_data"
fi

if [[ -n "${PB_DATA_DIR}" ]]; then
  BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/logs/deploy-backups}"
  mkdir -p "${BACKUP_DIR}"
  if command -v zip >/dev/null 2>&1; then
    BACKUP_FILE="${BACKUP_DIR}/${PB_DATA_DIR}_$(date -u +%Y%m%dT%H%M%SZ).zip"
    echo "==> Creating local PocketBase backup: ${BACKUP_FILE}"
    zip -qr "${BACKUP_FILE}" "${PB_DATA_DIR}"
  else
    BACKUP_FILE="${BACKUP_DIR}/${PB_DATA_DIR}_$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
    echo "==> Creating local PocketBase backup: ${BACKUP_FILE}"
    tar -czf "${BACKUP_FILE}" "${PB_DATA_DIR}"
  fi
fi

echo "==> Removing old compose containers"
docker compose down --remove-orphans

echo "==> Starting compose services"
docker compose up -d

echo "==> Verifying app endpoint"
curl -fsS --max-time 20 "${DOMAIN}" >/dev/null

echo "==> Verifying PocketBase health through domain proxy"
curl -fsS --max-time 20 "${DOMAIN}/pb/api/health" >/dev/null

export PB_URL="${PB_URL:-${DOMAIN}/pb}"
echo "==> Ensuring PocketBase collections"
node scripts/ensure-casting-collections.mjs

echo "==> Verifying market-rate proxy"
curl -fsS --max-time 20 "${DOMAIN}/api/market-rate" >/dev/null

echo "Deployment complete: ${DOMAIN}"
