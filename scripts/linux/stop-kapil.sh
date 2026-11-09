#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

init_directories

for name in caddy pocketbase; do
  pid_file="$(get_pid_file "$name")"
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      write_log "Stopping $name (PID $pid)..."
      kill -TERM "$pid" 2>/dev/null || true
      for ((i=1; i<=10; i++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
          break
        fi
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      write_log "$name stopped."
    fi
    rm -f "$pid_file"
  fi
done
