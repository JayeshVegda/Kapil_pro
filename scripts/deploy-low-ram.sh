#!/usr/bin/env bash
set -euo pipefail

# Low-RAM deployment for Kapil billing web container.
# Strategy:
# 1) Build image
# 2) Remove old web container
# 3) Start new web container (single instance only)
# 4) Verify health endpoints

APP_DIR="${APP_DIR:-/home/ubuntu/Kapil_pro}"
IMAGE_NAME="${IMAGE_NAME:-billing-billing-web:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-kapil-billing-web}"
HOST_PORT="${HOST_PORT:-8088}"
CONTAINER_PORT="${CONTAINER_PORT:-80}"
DOMAIN="${DOMAIN:-https://kapil.cosearch.me}"

echo "==> Building image: ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" "${APP_DIR}"

if docker ps -a --format '{{.Names}}' | rg -x "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "==> Removing previous container: ${CONTAINER_NAME}"
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

echo "==> Starting new container: ${CONTAINER_NAME}"
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  --add-host host.docker.internal:host-gateway \
  "${IMAGE_NAME}" >/dev/null

echo "==> Verifying app endpoint"
curl -fsS --max-time 20 "${DOMAIN}" >/dev/null

echo "==> Verifying PocketBase health through domain proxy"
curl -fsS --max-time 20 "${DOMAIN}/pb/api/health" >/dev/null

echo "Deployment complete (low-RAM mode)."
