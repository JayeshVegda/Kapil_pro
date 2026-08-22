# Windows Local-Primary Design

## Objective

Prepare a separate `kapil-windows` branch that runs Kapil Billing only on one Windows PC with 4 GB RAM. The Windows machine becomes the sole active application and database host. The existing VPS project remains unchanged and is not part of normal operation.

## Isolation

Development happens only in `/home/ubuntu/kapil-windows`, an isolated Git worktree created from the committed `kapil-v2` branch. The branch name is `kapil-windows`. Uncommitted files in the existing VPS worktree are excluded. Windows-specific code, scripts, and documentation live only on this branch.

Runtime data, database backups, credentials, downloaded executables, and logs are excluded from Git. GitHub contains reproducible setup material, never the live business database.

## Runtime architecture

The package uses native Windows executables instead of Docker Desktop:

- PocketBase owns the SQLite-backed business database and listens on `127.0.0.1:8090`.
- Caddy serves the built React application and proxies `/pb` to PocketBase while listening on `127.0.0.1:4174`.
- The browser opens `http://127.0.0.1:4174`.
- Neither service binds to the LAN, so phones and other computers cannot connect.
- PowerShell scripts start, stop, inspect, update, back up, and restore the installation.

This keeps idle memory use low enough for a 4 GB PC and avoids Docker Desktop's background overhead.

## Repository layout

Windows-specific files use these boundaries:

- `windows/`: PowerShell automation, Caddy configuration, and task-scheduler helpers.
- `runtime/`: Git-ignored executables, live data, backups, logs, and process state.
- `AGENTS.md`: authoritative instructions and safety boundaries for a Windows AI assistant.
- `WINDOWS-SETUP.md`: first installation and one-time database migration.
- `DATABASE-RUNBOOK.md`: backup, restore, retention, and recovery verification.
- `TROUBLESHOOTING.md`: startup, ports, browser, database, and update failures.
- `.env.windows.example`: non-secret configuration template.

Scripts resolve paths relative to the repository and do not depend on a fixed drive letter.

## Database migration and ownership

The current primary database is transferred as a PocketBase backup archive through a Git-ignored local transfer directory. It is never committed or pushed. Import is a deliberate one-time operation:

1. Verify the archive exists and is non-empty.
2. Stop local PocketBase.
3. Back up any existing local database.
4. Restore the transferred archive.
5. Start PocketBase and run health and record-count checks.
6. Mark the local installation as the active primary only after verification.

The Windows database is the only writable primary after cutover. There is no bidirectional synchronization with the VPS.

## Backup and restore

The backup script creates timestamped PocketBase archives and records success or failure in local logs. Retention keeps recent daily backups plus representative weekly and monthly copies. Backup runs automatically through Windows Task Scheduler and before update or restore operations.

Backups on the same PC protect against accidental edits but not disk loss. The runbook explicitly requires copying periodic archives to an external drive. Restore never overwrites live data without first creating a recovery backup. Health and record-count verification follows every restore.

## Operations and safety

Setup verifies Windows architecture, PowerShell version, required ports, free disk space, executable checksums, frontend build output, and PocketBase health. Start scripts reject duplicate processes. Stop scripts target only PIDs recorded by this installation. Update scripts back up data first and do not replace runtime data.

No script deletes broad directories, uses an unresolved home path as a destructive target, or stores credentials in Git. Failures stop with a clear message and recovery instruction.

## AI handoff

`AGENTS.md` explains architecture, business invariants, commands, file ownership, database safety, testing requirements, and prohibited actions. The Windows AI must inspect health and create a backup before database-affecting work. It must not rewrite or directly copy an active SQLite file, enable LAN listening, commit runtime data, or introduce a second writable database.

## Verification

Verification includes:

- PowerShell syntax checks where available;
- frontend typecheck, tests, and production build;
- localhost-only Caddy and PocketBase configuration review;
- clean-install and existing-data paths;
- backup archive creation and non-destructive restore rehearsal against disposable data;
- startup, shutdown, duplicate-start, health-check, and missing-file behavior;
- Git-ignore checks proving database, secrets, binaries, backups, and logs cannot be committed;
- confirmation that the existing `/opt/stacks/sites/kapil` working files remain unchanged.

## Initial milestone

The first milestone prepares the branch, native Windows runtime configuration, safe migration path, scripts, and complete operator/AI documentation. It does not perform the final Windows cutover, disable the VPS, expose the service to the LAN, or redesign application features.
