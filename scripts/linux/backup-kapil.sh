#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

init_directories
assert_file "$DATA_DIR/data.db" "PocketBase database"

# Only the database process must stop; Caddy retains its original state.
pb_mode=stopped
if systemctl --user is-active --quiet kapil-pb.service 2>/dev/null; then
  pb_mode=systemd
elif get_running_pid "pocketbase" >/dev/null; then
  pb_mode=direct
fi

resume_original_state() {
  local status=$?
  trap - EXIT
  if [[ "$pb_mode" == systemd ]]; then
    write_log "Restarting kapil-pb.service after backup..."
    if ! systemctl --user start kapil-pb.service; then status=1; fi
  elif [[ "$pb_mode" == direct ]]; then
    write_log "Restarting PocketBase after backup..."
    if ! start_pocketbase; then status=1; fi
  fi
  exit "$status"
}
trap resume_original_state EXIT

if [[ "$pb_mode" == systemd ]]; then
  write_log "Stopping kapil-pb.service for backup..."
  systemctl --user stop kapil-pb.service
  if systemctl --user is-active --quiet kapil-pb.service; then
    echo "ERROR: PocketBase is still active; backup cancelled." >&2
    exit 1
  fi
elif [[ "$pb_mode" == direct ]]; then
  stop_process pocketbase
fi
assert_port_free 8090 PocketBase

stamp="$(date +%Y%m%d-%H%M%S)"
archive="$BACKUP_DIR/kapil-local-$stamp.zip"

write_log "Creating backup: $archive..."
(cd "$DATA_DIR" && zip -q -r "$archive" .)

size=$(stat -c%s "$archive" 2>/dev/null || stat -f%z "$archive" 2>/dev/null || echo 0)
if [[ "$size" -lt 100000 ]]; then
  echo "ERROR: Backup archive is unexpectedly small ($size bytes)" >&2
  exit 1
fi

(cd "$BACKUP_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256.txt")
write_log "Backup completed: $archive (Size: $size bytes)"

# Retention pruning: keep 4 recent, 8 weekly, 6 monthly
python3 - <<EOF
import os, glob, re
from datetime import datetime

backup_dir = "$BACKUP_DIR"
files = sorted(glob.glob(os.path.join(backup_dir, "kapil-local-*.zip")), key=os.path.getmtime, reverse=True)
if len(files) <= 4:
    exit(0)

keep = set()
# 4 most recent
for f in files[:4]:
    keep.add(f)

# Weekly & Monthly buckets
weeks = {}
months = {}
for f in files:
    m = re.search(r'kapil-local-(\d{8})', os.path.basename(f))
    if m:
        dt = datetime.strptime(m.group(1), "%Y%m%d")
        wk = f"{dt.year}-{dt.isocalendar()[1]}"
        mo = f"{dt.year}-{dt.month:02d}"
        if wk not in weeks and len(weeks) < 8:
            weeks[wk] = f
            keep.add(f)
        if mo not in months and len(months) < 6:
            months[mo] = f
            keep.add(f)

for f in files:
    if f not in keep:
        print(f"Pruning expired backup: {f}")
        try: os.remove(f)
        except OSError: pass
        try: os.remove(f + ".sha256.txt")
        except OSError: pass
EOF

write_log "Backup retention pruning complete."
echo "$archive"
