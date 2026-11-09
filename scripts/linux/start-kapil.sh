#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

init_directories
assert_file "$POCKETBASE_BIN" "PocketBase binary"
assert_file "$CADDY_BIN" "Caddy binary"
assert_file "$PROJECT_ROOT/dist/index.html" "Built frontend index.html"
assert_file "$PROJECT_ROOT/Caddyfile" "Caddyfile"

start_pocketbase
start_caddy
write_log "Kapil Billing is healthy at http://127.0.0.1:4174"
