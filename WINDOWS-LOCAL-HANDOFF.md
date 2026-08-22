# Kapil Pro Windows Local-Primary Handoff

Last verified: 2026-08-05 (Asia/Kolkata)

This document records the actual Windows installation, local changes, automation,
database safeguards, credentials handling, RSS behavior, and operating procedures.
Read this together with `AGENTS.md`, `WINDOWS-SETUP.md`,
`DATABASE-RUNBOOK.md`, `TROUBLESHOOTING.md`, and
`database-transfer/README.md` before changing runtime or database behavior.

## 1. Installation summary

- Source package: `JayeshVegda-Kapil_pro-49c561a.zip`
- Intended source branch/commit: `kapil-windows` / `49c561a`
- Project root:

  ```text
  C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a
  ```

- The source was installed from a GitHub ZIP, not a Git clone.
- There is no `.git` metadata and Git is not installed.
- Do not use `windows\update-kapil.ps1` until source-update strategy is
  deliberately redesigned for a ZIP-based installation.
- Node.js was already present and was used to build the frontend.
- `node_modules` is retained because the scheduled full RSS importer uses the
  existing Node script for a few seconds per run. Node does not remain running
  as part of the Kapil runtime.
- PocketBase and Caddy were downloaded by the repository setup script into
  `runtime\bin`.
- No Docker, Git, OpenSSL, IIS, or VPS runtime is used.

## 2. Runtime architecture

```text
Browser
  -> http://127.0.0.1:4174 (Caddy)
       -> static frontend from dist\
       -> /pb/* -> http://127.0.0.1:8090 (PocketBase)
       -> /api/market-rate -> https://rss.zayu.dev/telegram/channel/brassb2b

PocketBase
  -> runtime\data\data.db
  -> runtime\data\auxiliary.db
```

Security constraints:

- Caddy listens only on `127.0.0.1:4174`.
- PocketBase listens only on `127.0.0.1:8090`.
- Do not change either listener to `0.0.0.0` or a LAN address without a new
  security design explicitly approved by the owner.
- This Windows database is the sole writable primary after cutover.
- Never reintroduce a second writable VPS database or bidirectional sync.

Typical observed idle RAM:

- PocketBase: approximately 89 MB
- Caddy: approximately 32 MB
- Kapil runtime total: approximately 122 MB

## 3. Frontend environment

Local ignored file:

```text
.env
```

Current contents:

```dotenv
VITE_LOGIN_EMAIL=jay@kapil.cosearch.me
VITE_POCKETBASE_URL=/pb
VITE_MARKET_RATE_URL=/api/market-rate
```

These are compile-time Vite settings. They contain no password or recovery
secret. If changed, rebuild `dist` before expecting the browser to see them.

The frontend was built using Windows-compatible direct commands because the
repository's npm scripts contain Linux-style `PATH=...` prefixes. The successful
build sequence was equivalent to:

```powershell
node .\node_modules\@tanstack\router-cli\bin\tsr.cjs generate
.\node_modules\.bin\tsc.cmd -b --pretty false
.\node_modules\.bin\vite.cmd build
```

Vite loads the three values from `.env` automatically.

## 4. Authentication

### Kapil application user

- Configured application login email: `jay@kapil.cosearch.me`
- The application uses the `users` collection.
- Its password is not stored in `.env` or this document.

### PocketBase superuser

- Admin URL: `http://127.0.0.1:8090/_/`
- Local superuser email: `jayeshvegda198@gmail.com`
- The local superuser was created/updated and authentication was verified.
- The password must not be written into documentation, source, logs, or chat
  handoffs.

The RSS task stores the superuser credential using current-user Windows DPAPI:

```text
runtime\state\pb-admin-email.txt
runtime\state\pb-admin-password.dpapi
```

The password file is encrypted for the Windows user that created it. Scheduled
RSS tasks therefore run as that same interactive user. Do not copy the DPAPI
file to another PC and expect it to decrypt. On a replacement Windows account,
recreate the credential securely.

## 5. Production database migration

The encrypted production transfer was validated before decryption.

Encrypted transfer SHA-256:

```text
0f5d64fbbc37370355d331182c64f431a7d70f553ddd1dcd4f9b01d2d1a55c62
```

Decrypted transfer SHA-256:

```text
59c27ed55352a121ac5e01d8ad32263c28e4eb71c054d0fa49f66a23fd56449d
```

The transfer was decrypted with Windows built-in .NET AES/PBKDF2 logic rather
than installing Git/OpenSSL, then restored using `windows\restore-kapil.ps1`.

Important state:

- The production database is active under `runtime\data`.
- The original encrypted transfer remains under `database-transfer`.
- A decrypted transfer ZIP may still remain under `runtime\transfer`; it is
  redundant after verified local/external backups and should never be committed.
- No plaintext recovery-key file exists under `runtime\transfer`.
- The recovery key is intentionally not reproduced in this document.

Never copy, replace, edit, or compress the active SQLite files. PocketBase uses
WAL and auxiliary files. Use the supplied stop/backup/restore scripts only.

## 6. Runtime script change

`windows\start-kapil.ps1` was hardened to normalize duplicate inherited
`Path`/`PATH` environment entries before calling `Start-Process`. This fixes a
Windows PowerShell failure seen under launcher environments that provide both
case variants.

The script still:

- validates the PocketBase executable, Caddy executable, and built frontend;
- starts PocketBase on loopback port 8090;
- starts Caddy on loopback port 4174;
- prevents duplicate managed processes using PID files;
- waits for health endpoints before returning.

## 7. RSS source and persistence

Source:

```text
https://rss.zayu.dev/telegram/channel/brassb2b
```

The RSS endpoint and local Caddy proxy both returned HTTP 200 during setup.

### Database collection

Collection: `brass_rates`

The schema includes, among other fields:

- `date`
- `vilaity`
- `honey_gulf`
- `honey_europe`
- bulletin time, weekday, source, raw text, GUID, and link
- Jamnagar trends
- `plant_pass`, `zinc_9995`, and trends
- `delhi_honey`, `delhi_local`, `armature`, and trends
- `mcx_copper`, `mcx_zinc`, and trends
- `lme_3m`, `usd_inr`, and trends

The schema fields were not missing. Anonymous PocketBase API calls returned zero
visible rows because collection access rules require authentication. An
authenticated superuser query showed 130 records.

The full repository importer refreshed the 16 bulletins available in the live
RSS feed. As of 2026-08-05, the latest saved row was:

| Field | Value |
|---|---:|
| Date | 2026-08-05 |
| Bulletin time | 10:30 AM |
| Vilaity | 855 |
| Honey Gulf | 885 |
| Honey Europe | 890 |
| Plant Pass | 357 |
| Zinc 99.95 | 398 |
| Delhi Honey | 877 |
| Delhi Local | 828 |
| Armature | 1286 |
| MCX Copper | 1365.75 |
| MCX Zinc | 388.5 |
| LME 3M | 14040 |
| USD/INR | 95.05 |

### Synchronization implementation

Runner:

```text
windows\sync-brass-rates.ps1
```

It decrypts the DPAPI credential only in memory, verifies local PocketBase
health, and calls the existing tested importer:

```text
scripts\brass-rss-watch.mjs
```

Two modes exist:

- Catch-up mode at sign-in uses `--backfill --no-telegram`. It imports or
  updates all bulletin dates still present in RSS, covering days missed while
  the PC was off.
- `-LatestOnly` mode first queries PocketBase for today's date. If today's row
  already exists, it exits before contacting RSS or writing the database. If
  missing, it requests the feed and requires today's bulletin.

Failures are non-destructive, return a nonzero task result, and are logged. A
later trigger or the next sign-in retries.

RSS log:

```text
runtime\logs\brass-sync.log
```

The abandoned experimental PocketBase cron hook was removed. RSS automation is
implemented only through Windows Task Scheduler plus the proven Node importer.

## 8. Scheduled automation

Installer stored inside the repository:

```text
windows\admin-tools\Install-Kapil-Automation.ps1
windows\admin-tools\Install Kapil Automation.cmd
```

Rollback script:

```text
windows\admin-tools\Remove-Kapil-Automation.ps1
```

The rollback script removes scheduled tasks only. It does not remove the
application, database, logs, or backups.

Installed tasks:

### Kapil Billing Start

- Trigger: owner sign-in
- Action: `windows\start-kapil.ps1 -NoBrowser`
- Runs elevated as the interactive owner
- Last verified task result: `0` (success)

### Kapil Brass RSS Catch-up

- Trigger: owner sign-in
- Action: `windows\sync-brass-rates.ps1`
- Backfills every available RSS bulletin date
- Last verified task result: `0` (success)

### Kapil Brass RSS Daily

- Triggers: 10:10, 10:30, 10:50, and 11:10 AM daily
- Action: `windows\sync-brass-rates.ps1 -LatestOnly`
- Stops immediately after detecting that today's row is already saved
- Multiple instances are ignored
- Configured to retry failures through Task Scheduler settings

### Kapil Billing Weekly Backup

- Trigger: Sunday at 6:00 PM
- Action:

  ```text
  windows\backup-kapil.ps1 -RecentCount 4 -WeeklyCount 8 -MonthlyCount 6
  ```

- `StartWhenAvailable` is enabled for missed runs
- Runs elevated as the interactive owner

Task Scheduler code `267011` (`0x41303`) means a newly created scheduled task
has not run yet. It is not a backup or RSS failure. Result `0` means success.

## 9. Backup design

Backup directory:

```text
runtime\backups
```

Each recovery point contains:

```text
kapil-local-YYYYMMDD-HHMMSS.zip
kapil-local-YYYYMMDD-HHMMSS.zip.sha256.txt
```

`windows\backup-kapil.ps1`:

1. Determines whether Kapil is running.
2. Stops Caddy and PocketBase cleanly.
3. Compresses the complete stopped `runtime\data` directory.
4. Rejects an unexpectedly small archive.
5. calculates SHA-256 and creates a sidecar file.
6. Restarts Kapil if it was running.
7. Applies rotating retention.

Configured retention:

- 4 most recent recovery points
- 8 representative weekly recovery points
- 6 representative monthly recovery points

Backups can overlap retention categories, so actual file count is generally
below the theoretical sum. At the observed 30-40 MB per archive, local storage
should remain modest.

Operations log:

```text
runtime\logs\operations.log
```

Local backups on the same `C:` drive protect against operator errors and many
software failures but not drive loss, theft, or whole-machine ransomware. At
least weekly, copy the newest ZIP and matching SHA-256 sidecar to a disconnected
external drive. Do not synchronize the live `runtime\data` directory.

## 10. Restore procedure

Always verify the selected backup hash first, then use the supplied script:

```powershell
Set-Location C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a
Get-FileHash -Algorithm SHA256 .\runtime\backups\kapil-local-YYYYMMDD-HHMMSS.zip
.\windows\restore-kapil.ps1 -Archive .\runtime\backups\kapil-local-YYYYMMDD-HHMMSS.zip
.\windows\health-check.ps1
```

The restore script creates a safety backup and preserves the replaced database
directory as `runtime\data-before-restore-<timestamp>`. Never delete rollback or
staging directories until business data is verified.

After restore, verify:

- application login;
- customer count;
- latest bill reference and date;
- latest payment amount and date;
- Aryan Enterprice balance;
- current brass rate;
- an existing bill preview;
- `runtime\logs\operations.log` restore entry.

## 11. Normal operator commands

Because the system PowerShell execution policy may block direct script calls,
the safe explicit form is:

```powershell
$repo = 'C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo\windows\start-kapil.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo\windows\health-check.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo\windows\backup-kapil.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo\windows\stop-kapil.ps1"
```

Application URL:

```text
http://127.0.0.1:4174
```

PocketBase administration:

```text
http://127.0.0.1:8090/_/
```

## 12. Health and verification

Expected health-check result:

```text
PocketBase process       OK
Caddy process            OK
Database file            OK
Frontend build           OK
http://127.0.0.1:8090/api/health HTTP 200
http://127.0.0.1:4174    HTTP 200
```

Inspect scheduled tasks:

```powershell
Get-ScheduledTask | Where-Object TaskName -Like 'Kapil *'
Get-ScheduledTaskInfo -TaskName 'Kapil Billing Weekly Backup'
Get-ScheduledTaskInfo -TaskName 'Kapil Brass RSS Catch-up'
Get-ScheduledTaskInfo -TaskName 'Kapil Brass RSS Daily'
```

Inspect recent logs:

```powershell
Get-Content .\runtime\logs\operations.log -Tail 50
Get-Content .\runtime\logs\brass-sync.log -Tail 50
Get-Content .\runtime\logs\pocketbase.err.log -Tail 50
Get-Content .\runtime\logs\caddy.err.log -Tail 50
```

## 13. Hotkey and shortcut status

A `Ctrl+Shift+K` shortcut was created earlier, but the later verification found
both shortcut files absent:

```text
C:\Users\Kapil\Desktop\Kapil Pro.lnk
C:\Users\Kapil\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Kapil Pro.lnk
```

Therefore another AI must not assume the global hotkey is currently active.
The website and automatic sign-in startup do not depend on the shortcut. If the
owner wants the hotkey restored, recreate a Start Menu `.lnk` targeting:

```text
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

with arguments:

```text
-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a\windows\start-kapil.ps1"
```

and set its hotkey property to `Ctrl+Shift+K`.

## 14. Known caveats and future work

1. This is a ZIP installation without Git metadata. Code updates need a
   deliberate ZIP replacement/merge procedure that preserves `.env`, `runtime`,
   Windows script changes, automation, and the sole writable database.
2. The npm scripts contain Linux-specific `PATH=...` syntax. Use the documented
   direct Windows build sequence unless those scripts are repaired and tested.
3. `node_modules` occupies disk but not runtime RAM. It is currently required by
   the scheduled RSS importer and must not be removed without first packaging or
   replacing that importer.
4. The decrypted transfer ZIP may be safely removed only after verified local
   and external recovery points exist. Never remove the original encrypted
   transfer or lose its separately stored recovery key.
5. Automatic weekly backups are local-only until an external-drive copy process
   is established.
6. Task principals use the interactive owner because DPAPI credentials are tied
   to that Windows user. Changing Windows accounts requires reinstalling tasks
   and recreating the encrypted credential.

## 15. Rules for the next AI

- Read the five repository instruction/runbook files and this handoff first.
- Run health check and a fresh backup before any database-affecting change.
- Do not access or copy active SQLite files directly.
- Do not expose ports to LAN or internet.
- Do not print, document, or commit passwords, DPAPI material, recovery keys,
  database files, backups, logs, executables, `runtime`, or `.env`.
- Preserve one writable database only.
- Prefer small, reversible changes and verify health afterward.
- For RSS issues, check authenticated `brass_rates` results; anonymous API rules
  can make an existing collection appear empty.
- For scheduled-task changes, update the installer under `windows\admin-tools`
  and rerun it elevated,
  then verify `Get-ScheduledTaskInfo` and task logs.
