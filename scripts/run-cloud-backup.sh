#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/stacks/sites/kapil"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.local/share/fnm/node-versions/v24.18.0/installation/bin/node}"
MODE="${1:-six-hour}"

if [[ ! -x "${NODE_BIN}" ]]; then
  echo "Node executable not found: ${NODE_BIN}" >&2
  exit 1
fi

case "${MODE}" in
  six-hour)
    EXTRA_ARGS=()
    ;;
  daily)
    EXTRA_ARGS=(--telegram)
    ;;
  *)
    echo "Usage: $0 [six-hour|daily]" >&2
    exit 2
    ;;
esac

cd "${PROJECT_DIR}"

export BACKUP_STATE_FILE="${PROJECT_DIR}/replica_state/backup-status.json"
export BACKUP_LOCK_FILE="${PROJECT_DIR}/replica_state/backup.lock"
export REPLICA_MAINTENANCE_FILE="${PROJECT_DIR}/replica_state/maintenance"
export REPLICA_CYCLE_FILE="${PROJECT_DIR}/replica_state/cycle"

exec /usr/bin/doppler run \
  --scope /opt/stacks \
  --project vps \
  --config prd \
  -- /usr/bin/doppler run \
  --scope "${PROJECT_DIR}" \
  --project kapil-billing \
  --config prd \
  -- "${NODE_BIN}" "${PROJECT_DIR}/scripts/pb-cloud-backup.mjs" "${EXTRA_ARGS[@]}"
