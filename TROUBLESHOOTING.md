# Windows Troubleshooting

## Site does not open

Run:

```powershell
.\windows\health-check.ps1
Get-Content .\runtime\logs\caddy.err.log -Tail 50
Get-Content .\runtime\logs\pocketbase.err.log -Tail 50
```

Then stop and start once. Do not launch extra copies of either executable manually.

## Port 4174 or 8090 is already in use

```powershell
Get-NetTCPConnection -LocalPort 4174,8090 -ErrorAction SilentlyContinue
```

If the owning PID is recorded in `runtime\state`, use `windows\stop-kapil.ps1`. If another application owns the port, stop that application. Do not change Kapil to a LAN address as a workaround.

## PocketBase starts but login fails

Confirm that `runtime\data\data.db` exists and that the expected transfer archive was restored. A fresh empty database has different users and no business records. Do not create replacement customers or bills until the correct database is restored.

## Market rate is unavailable

The app and database continue to work without the RSS source. Confirm the PC has internet access and visit:

```text
https://rss.zayu.dev/telegram/channel/brassb2b
```

Historical saved rates remain in PocketBase. Do not replace historical rates with guessed values.

## Backup fails

Check free disk space and `runtime\logs\operations.log`. Ensure no ZIP with the same timestamp is open. The script deliberately stops PocketBase before compression; do not bypass that safety rule.

## Restore fails

Follow the “Failed restore” section in `DATABASE-RUNBOOK.md`. Keep the archive, staging directory, rollback directory, and logs. Never delete all runtime directories to “start clean.”

## Update fails

The update script stops before restart when tests or the build fail. The database remains under `runtime\data` and the pre-update backup remains under `runtime\backups`. Fix the code or reset only the code branch after preserving intentional edits; never reset runtime data.

## Windows AI checklist

Before changing anything, the AI should report:

```powershell
git branch --show-current
git status --short
.\windows\health-check.ps1
Get-ChildItem .\runtime\backups\kapil-local-*.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 3
```

Before database-affecting work it must create a fresh backup. It must not expose ports, copy an active database, commit runtime data, or operate on the VPS branch.
