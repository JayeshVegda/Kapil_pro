param([string]$BackupTime = '18:00')
$startScript = Join-Path $PSScriptRoot 'start-kapil.ps1'
$backupScript = Join-Path $PSScriptRoot 'backup-kapil.ps1'
$startCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -NoBrowser' -f $startScript
$backupCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $backupScript
& schtasks.exe /Create /F /SC ONLOGON /TN 'Kapil Billing Start' /TR $startCommand
if ($LASTEXITCODE -ne 0) { throw 'Could not create startup task.' }
& schtasks.exe /Create /F /SC DAILY /ST $BackupTime /TN 'Kapil Billing Backup' /TR $backupCommand
if ($LASTEXITCODE -ne 0) { throw 'Could not create backup task.' }
Write-Host "Tasks installed. Daily backup time: $BackupTime"
