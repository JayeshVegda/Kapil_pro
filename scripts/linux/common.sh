#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/runtime"
BIN_DIR="$RUNTIME_DIR/bin"
DATA_DIR="$RUNTIME_DIR/data"
BACKUP_DIR="$RUNTIME_DIR/backups"
LOG_DIR="$RUNTIME_DIR/logs"
STATE_DIR="$RUNTIME_DIR/state"
TRANSFER_DIR="$RUNTIME_DIR/transfer"
POCKETBASE_BIN="$BIN_DIR/pocketbase"
CADDY_BIN="$BIN_DIR/caddy"

init_directories() {
  mkdir -p "$RUNTIME_DIR" "$BIN_DIR" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR" "$STATE_DIR" "$TRANSFER_DIR"
}

write_log() {
  init_directories
  local msg
  msg="[$(date -Iseconds)] $1"
  echo "$msg" >> "$LOG_DIR/operations.log"
  echo "$msg"
}

get_pid_file() {
  echo "$STATE_DIR/$1.pid"
}

get_running_pid() {
  local name="$1"
  local pid_file
  pid_file="$(get_pid_file "$name")"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  return 1
}

stop_process() {
  local name="$1" pid
  if ! pid="$(get_running_pid "$name")"; then return 0; fi
  write_log "Stopping $name (PID $pid)..."
  kill -TERM "$pid"
  for ((i=1; i<=30; i++)); do
    if ! kill -0 "$pid" 2>/dev/null || [[ "$(ps -o stat= -p "$pid" 2>/dev/null)" == Z* ]]; then
      rm -f "$(get_pid_file "$name")"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $name did not stop cleanly; backup is cancelled." >&2
  return 1
}

start_pocketbase() {
  if systemctl --user is-active --quiet kapil-pb.service 2>/dev/null; then
    wait_url "http://127.0.0.1:8090/api/health" 30
    return 0
  fi
  if get_running_pid pocketbase >/dev/null; then return 0; fi
  assert_file "$POCKETBASE_BIN" "PocketBase binary"
  assert_port_free 8090 PocketBase
  nohup "$POCKETBASE_BIN" serve --dir "$DATA_DIR" --http 127.0.0.1:8090 \
    --migrationsDir "$PROJECT_ROOT/pb_migrations" \
    --hooksDir "$PROJECT_ROOT/pb_hooks" \
    >> "$LOG_DIR/pocketbase.out.log" 2>> "$LOG_DIR/pocketbase.err.log" &
  local pid=$!
  echo "$pid" > "$(get_pid_file pocketbase)"
  write_log "PocketBase started (PID $pid)"
  wait_url "http://127.0.0.1:8090/api/health" 30
}

start_caddy() {
  if systemctl --user is-active --quiet kapil-web.service 2>/dev/null; then
    wait_url "http://127.0.0.1:4174" 30
    return 0
  fi
  if get_running_pid caddy >/dev/null; then return 0; fi
  assert_file "$CADDY_BIN" "Caddy binary"
  assert_file "$PROJECT_ROOT/Caddyfile" "Caddyfile"
  assert_port_free 4174 Caddy
  nohup "$CADDY_BIN" run --config "$PROJECT_ROOT/Caddyfile" --adapter caddyfile \
    >> "$LOG_DIR/caddy.out.log" 2>> "$LOG_DIR/caddy.err.log" &
  local pid=$!
  echo "$pid" > "$(get_pid_file caddy)"
  write_log "Caddy started (PID $pid)"
  wait_url "http://127.0.0.1:4174" 30
}

assert_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: $label not found at $file" >&2
    exit 1
  fi
}

assert_port_free() {
  local port="$1"
  local service="$2"
  if ss -tln | grep -q ":$port "; then
    echo "ERROR: Port $port is already in use; cannot safely start $service." >&2
    exit 1
  fi
}

wait_url() {
  local url="$1"
  local attempts="${2:-30}"
  for ((i=1; i<=attempts; i++)); do
    if curl -sf -o /dev/null --max-time 3 "$url"; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: Timed out waiting for $url" >&2
  return 1
}
