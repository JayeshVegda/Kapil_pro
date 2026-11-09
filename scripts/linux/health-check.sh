#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

echo "Checking PocketBase at http://127.0.0.1:8090/api/health..."
pb_health="$(curl -sf --max-time 5 "http://127.0.0.1:8090/api/health" || echo "")"
if [[ -z "$pb_health" ]]; then
  echo "FAIL: PocketBase is not responding at 127.0.0.1:8090" >&2
  exit 1
fi
echo "PocketBase response: $pb_health"

echo "Checking Caddy web service at http://127.0.0.1:4174..."
caddy_status="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:4174")"
if [[ "$caddy_status" != "200" ]]; then
  echo "FAIL: Caddy returned HTTP $caddy_status (expected 200)" >&2
  exit 1
fi
echo "Caddy response: HTTP $caddy_status"

echo "Checking Caddy PocketBase reverse proxy at http://127.0.0.1:4174/pb/api/health..."
caddy_pb_health="$(curl -sf --max-time 5 "http://127.0.0.1:4174/pb/api/health" || echo "")"
if [[ -z "$caddy_pb_health" ]]; then
  echo "FAIL: Caddy /pb proxy is not responding" >&2
  exit 1
fi
echo "Caddy /pb proxy response: $caddy_pb_health"

echo "ALL SERVICES HEALTHY"
