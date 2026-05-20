#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_PATH}/.env.production"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

PB_DATA_PATH="${PROJECT_PATH}/pb_data"
LOG_DIR="${PROJECT_PATH}/logs"
LOG_FILE="${LOG_DIR}/backup.log"
RCLONE_REMOTE="b2crypt"
RCLONE_FOLDER="KapilBackups"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN before running backup-daily.sh}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:?Set TELEGRAM_CHAT_ID before running backup-daily.sh}"

DATE_UTC="$(date -u +%F)"
STAMP_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
HOSTNAME_SHORT="$(hostname)"

mkdir -p "${LOG_DIR}"

BACKUP_TMP_DIR=""
cleanup() {
  rm -rf "${BACKUP_TMP_DIR:-}"
}
trap cleanup EXIT

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" | tee -a "${LOG_FILE}"
}

rotate_remote_file() {
  local new_name="$1"
  local old_name="$2"
  local folder_path="${RCLONE_REMOTE}:${RCLONE_FOLDER}"
  if rclone lsf "${folder_path}" --files-only | rg -x "${new_name}" >/dev/null 2>&1; then
    log "Remote file ${new_name} exists; rotating to ${old_name}"
    rclone moveto "${folder_path}/${new_name}" "${folder_path}/${old_name}"
  else
    log "Remote file ${new_name} does not exist; skipping rotation"
  fi
}

upload_remote_file() {
  local local_file="$1"
  local remote_name="$2"
  local folder_path="${RCLONE_REMOTE}:${RCLONE_FOLDER}"
  log "Uploading ${local_file} to ${folder_path}/${remote_name}"
  rclone copyto "${local_file}" "${folder_path}/${remote_name}"
}

main() {
  log "Backup job started on host ${HOSTNAME_SHORT}"
  log "Project path: ${PROJECT_PATH}"
  log "PocketBase data path: ${PB_DATA_PATH}"

  BACKUP_TMP_DIR="$(mktemp -d)"

  local pb_zip="${BACKUP_TMP_DIR}/kapil_pb_${DATE_UTC}.zip"
  local code_zip="${BACKUP_TMP_DIR}/kapil_project_${DATE_UTC}.zip"
  local db_zip="${BACKUP_TMP_DIR}/kapil_db_${DATE_UTC}.zip"

  rclone mkdir "${RCLONE_REMOTE}:${RCLONE_FOLDER}" >/dev/null 2>&1 || true

  log "Creating PocketBase zip for Telegram: ${pb_zip}"
  (
    cd "${PROJECT_PATH}"
    zip -r "${pb_zip}" "pb_data" >/dev/null
  )

  local pb_size
  pb_size="$(du -h "${pb_zip}" | awk '{print $1}')"
  local pb_sha
  pb_sha="$(sha256sum "${pb_zip}" | awk '{print $1}')"
  log "Telegram zip ready size=${pb_size} sha256=${pb_sha}"

  local caption
  caption=$(
    cat <<EOF
🔒 BACKUP SUCCESSFUL
Kapil Products · $(date -u +"%d %b %Y")

🗄 Database     ${pb_size}
⏱ Completed    $(TZ="Asia/Kolkata" date +"%I:%M %p") IST
☁️ Cloud        Uploaded
EOF
  )

  log "Sending PocketBase zip to Telegram chat ${TELEGRAM_CHAT_ID}"
  curl -sS --fail \
    -F "chat_id=${TELEGRAM_CHAT_ID}" \
    -F "caption=${caption}" \
    -F "document=@${pb_zip}" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" >/dev/null
  log "Telegram upload completed"

  log "Creating codebase zip for cloud storage: ${code_zip}"
  (
    cd "${PROJECT_PATH}"
    zip -r "${code_zip}" . \
      -x "./node_modules/*" \
      -x "./.git/*" \
      -x "./dist/*" \
      -x "./kapil_backup_new.zip" \
      -x "./kapil_backup_old.zip" \
      -x "./kapil_db_backup_new.zip" \
      -x "./kapil_db_backup_old.zip" \
      >/dev/null
  )

  rotate_remote_file "kapil_backup_new.zip" "kapil_backup_old.zip"
  upload_remote_file "${code_zip}" "kapil_backup_new.zip"

  log "Creating PocketBase DB zip for cloud storage: ${db_zip}"
  (
    cd "${PROJECT_PATH}"
    zip -r "${db_zip}" "pb_data" >/dev/null
  )

  rotate_remote_file "kapil_db_backup_new.zip" "kapil_db_backup_old.zip"
  upload_remote_file "${db_zip}" "kapil_db_backup_new.zip"

  log "Backup job finished successfully"
}

main "$@"
