$ErrorActionPreference = 'Stop'
$names = @(
  'Kapil Billing Start',
  'Kapil Brass RSS Catch-up',
  'Kapil Brass RSS Daily',
  'Kapil Billing Weekly Backup'
)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"')
  )
  exit
}
foreach ($name in $names) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
Write-Host 'Kapil scheduled tasks removed. Application data and backups were not changed.' -ForegroundColor Green
Read-Host 'Press Enter to close'
