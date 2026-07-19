#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${B2_ACCOUNT_ID:-}" || -z "${RESTIC_REPOSITORY:-}" || -z "${RESTIC_PASSWORD:-}" ]]; then
  exec /usr/bin/doppler run \
    --scope /opt/stacks \
    --project vps \
    --config prd \
    -- "$0" "$@"
fi

REPOSITORY_PATH="${RESTIC_REPOSITORY#b2:}"
B2_BUCKET="${REPOSITORY_PATH%%:*}"
CRYPT_PASSWORD="${KAPIL_BACKUP_ENCRYPTION_PASSWORD:-${RESTIC_PASSWORD}}"
OBSCURED_PASSWORD="$(rclone obscure "${CRYPT_PASSWORD}")"

export RCLONE_CONFIG_KAPILB2_TYPE=b2
export RCLONE_CONFIG_KAPILB2_ACCOUNT="${B2_ACCOUNT_ID}"
export RCLONE_CONFIG_KAPILB2_KEY="${B2_ACCOUNT_KEY:?B2_ACCOUNT_KEY is required}"
export RCLONE_CONFIG_KAPILCRYPT_TYPE=crypt
export RCLONE_CONFIG_KAPILCRYPT_REMOTE="kapilb2:${B2_BUCKET}/kapil-pocketbase"
export RCLONE_CONFIG_KAPILCRYPT_PASSWORD="${OBSCURED_PASSWORD}"
export RCLONE_CONFIG_KAPILCRYPT_FILENAME_ENCRYPTION=standard
export RCLONE_CONFIG_KAPILCRYPT_DIRECTORY_NAME_ENCRYPTION=true

ACTION="${1:-list}"

case "${ACTION}" in
  list)
    exec rclone lsl kapilcrypt:
    ;;
  download)
    REMOTE_PATH="${2:?Usage: $0 download YYYY/MM/backup.zip /destination/backup.zip}"
    DESTINATION="${3:?Usage: $0 download YYYY/MM/backup.zip /destination/backup.zip}"
    exec rclone copyto --checksum --retries 3 "kapilcrypt:${REMOTE_PATH}" "${DESTINATION}"
    ;;
  *)
    echo "Usage: $0 [list|download REMOTE_PATH DESTINATION]" >&2
    exit 2
    ;;
esac
