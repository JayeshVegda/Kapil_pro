import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function runBackup(options: { systemd?: boolean; running?: boolean; failZip?: boolean; caddyRunning?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'kapil-backup-test-'))
  const scripts = join(root, 'scripts')
  const data = join(root, 'data')
  const backup = join(root, 'backups')
  const bin = join(root, 'bin')
  const events = join(root, 'events.log')
  for (const dir of [scripts, data, backup, bin]) mkdirSync(dir)
  writeFileSync(events, '')
  writeFileSync(join(data, 'data.db'), 'synthetic test database')
  copyFileSync(new URL('./backup-kapil.sh', import.meta.url), join(scripts, 'backup-kapil.sh'))
  const event = (message: string) => `printf '%s\\n' '${message}' >> "$EVENTS"`
  writeFileSync(join(scripts, 'common.sh'), `
DATA_DIR="$TEST_ROOT/data"
BACKUP_DIR="$TEST_ROOT/backups"
POCKETBASE_BIN="$TEST_ROOT/bin/pocketbase"
CADDY_BIN="$TEST_ROOT/bin/caddy"
PROJECT_ROOT="$TEST_ROOT"
LOG_DIR="$TEST_ROOT"
STATE_DIR="$TEST_ROOT"
init_directories() { :; }
assert_file() { test -f "$1"; }
assert_port_free() { :; }
write_log() { printf '%s\\n' "$1" >> "$EVENTS"; }
get_running_pid() { if test -f "$TEST_ROOT/$1.running"; then printf '123'; else return 1; fi; }
get_pid_file() { printf '%s/%s.pid' "$TEST_ROOT" "$1"; }
stop_process() { ${event('stop-process')}; rm -f "$TEST_ROOT/$1.running"; }
start_pocketbase() { ${event('start-pocketbase')}; touch "$TEST_ROOT/pocketbase.running"; }
start_caddy() { ${event('start-caddy')}; touch "$TEST_ROOT/caddy.running"; }
wait_url() { :; }
`)
  writeFileSync(join(scripts, 'stop-kapil.sh'), `#!/usr/bin/env bash\n${event('stop-all')}\nrm -f "$TEST_ROOT/pocketbase.running" "$TEST_ROOT/caddy.running"\n`, { mode: 0o755 })
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env bash
if [[ "$2" == "is-active" ]]; then
  [[ "$SYSTEMD" == "yes" && -f "$TEST_ROOT/systemd.running" ]]; exit $?
fi
if [[ "$2" == "stop" ]]; then ${event('systemd-stop')}; rm -f "$TEST_ROOT/systemd.running"; fi
if [[ "$2" == "start" ]]; then ${event('systemd-start')}; touch "$TEST_ROOT/systemd.running"; fi
`, { mode: 0o755 })
  writeFileSync(join(bin, 'zip'), `#!/usr/bin/env bash
${event('zip')}
if [[ "$FAIL_ZIP" == "yes" ]]; then exit 12; fi
/usr/bin/truncate -s 120000 "$3"
`, { mode: 0o755 })
  if (options.systemd) writeFileSync(join(root, 'systemd.running'), '')
  else if (options.running) writeFileSync(join(root, 'pocketbase.running'), '')
  if (options.caddyRunning) writeFileSync(join(root, 'caddy.running'), '')
  let exitCode = 0
  try {
    execFileSync('bash', [join(scripts, 'backup-kapil.sh')], {
      env: { ...process.env, TEST_ROOT: root, EVENTS: events, SYSTEMD: options.systemd ? 'yes' : 'no', FAIL_ZIP: options.failZip ? 'yes' : 'no', PATH: `${bin}:${process.env.PATH}` },
      timeout: 10_000, stdio: 'pipe',
    })
  } catch (error) {
    exitCode = (error as { status?: number }).status ?? 1
  }
  const log = readFileSync(events, 'utf8')
  rmSync(root, { recursive: true, force: true })
  return { log, exitCode }
}

describe('Linux backup lifecycle with synthetic service stubs', () => {
  it('restarts direct PocketBase after a successful backup without stopping Caddy', () => {
    const { log, exitCode } = runBackup({ running: true, caddyRunning: true })
    expect(exitCode).toBe(0)
    expect(log).toContain('start-pocketbase')
    expect(log).not.toContain('stop-all')
    expect(log).not.toContain('start-caddy')
    expect(log.indexOf('stop-process')).toBeLessThan(log.indexOf('zip'))
  })

  it('restarts direct PocketBase when archive creation fails', () => {
    const { log, exitCode } = runBackup({ running: true, failZip: true })
    expect(exitCode).not.toBe(0)
    expect(log).toContain('start-pocketbase')
  })

  it('restores systemd PocketBase after a successful backup', () => {
    const { log, exitCode } = runBackup({ systemd: true })
    expect(exitCode).toBe(0)
    expect(log).toContain('systemd-stop')
    expect(log).toContain('systemd-start')
    expect(log).not.toContain('start-pocketbase')
  })

  it('restores systemd PocketBase after a failed archive', () => {
    const { log, exitCode } = runBackup({ systemd: true, failZip: true })
    expect(exitCode).not.toBe(0)
    expect(log).toContain('systemd-start')
  })

  it('leaves an initially stopped database stopped', () => {
    const { log, exitCode } = runBackup({})
    expect(exitCode).toBe(0)
    expect(log).not.toContain('start-pocketbase')
    expect(log).not.toContain('systemd-start')
  })
})
