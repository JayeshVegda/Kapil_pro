# Database Backup and Recovery Runbook

## Source of truth

After cutover, the only writable source of truth is:

```text
runtime\data\data.db
```

Do not open this SQLite file in an editor, synchronize it through OneDrive while PocketBase is running, or copy it while PocketBase is active. PocketBase may also use WAL and auxiliary files; copying only `data.db` can produce an inconsistent recovery point.

## Create a backup

```powershell
.\windows\health-check.ps1
.\windows\backup-kapil.ps1
```

The script records whether Kapil is running, stops it, compresses the complete data directory, writes a SHA-256 sidecar, and restarts the app. Archives are placed in `runtime\backups`.

Retention preserves 14 recent backups plus representative weekly and monthly archives. This protects against operator mistakes, but backups on the same drive do not protect against disk failure.

## External-drive rule

At least weekly, copy the newest `.zip` and matching `.sha256.txt` from `runtime\backups` to an external drive. Disconnect the drive after the copy. Keep at least three monthly archives. Never make the live `runtime\data` directory the synchronization target.

## Restore

1. Identify the archive and matching hash file.
2. Confirm its SHA-256 with `Get-FileHash`.
3. Run the restore script.
4. Run health checks and inspect business records.

```powershell
Get-FileHash -Algorithm SHA256 D:\KapilBackups\kapil-local-YYYYMMDD-HHMMSS.zip
.\windows\restore-kapil.ps1 -Archive D:\KapilBackups\kapil-local-YYYYMMDD-HHMMSS.zip
.\windows\health-check.ps1
```

Restore creates a new safety backup first. The replaced data directory is retained as `runtime\data-before-restore-<timestamp>` instead of being deleted. Do not remove it until the restored system has been used and verified.

## Verification after restore

- Sign in successfully.
- Confirm customer and item lists load.
- Confirm the latest bill and payment.
- Open Aryan Enterprice and another frequently used party ledger.
- Preview an existing bill without saving changes.
- Confirm market rate history loads.
- Check `runtime\logs\operations.log` for a successful restore line.

## Failed restore

Do not repeatedly rerun restore. Stop Kapil and preserve all of these directories and files:

- `runtime\data`
- `runtime\data-before-restore-*`
- `runtime\restore-staging-*`
- the archive and hash file
- `runtime\logs`

The previous database remains in the timestamped rollback directory. A knowledgeable operator or AI can compare and move it back only while PocketBase is stopped.

## Disaster recovery

On a replacement PC:

1. clone the `kapil-windows` branch;
2. run `windows\setup.ps1`;
3. copy a verified external-drive backup into `runtime\transfer`;
4. restore it with `windows\restore-kapil.ps1`;
5. verify the business records above;
6. reinstall startup and backup tasks.
