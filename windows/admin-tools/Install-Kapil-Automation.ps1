$ErrorActionPreference = 'Stop'
$repo = 'C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a'
$windowsDir = Join-Path $repo 'windows'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"')
  )
  exit
}

foreach ($required in @('start-kapil.ps1', 'backup-kapil.ps1', 'sync-brass-rates.ps1')) {
  if (-not (Test-Path -LiteralPath (Join-Path $windowsDir $required) -PathType Leaf)) {
    throw "Required Kapil script is missing: $required"
  }
}

function New-KapilAction([string]$Script, [string]$ExtraArguments = '') {
  $arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" {1}' -f (Join-Path $windowsDir $Script), $ExtraArguments
  return New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $repo
}

$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$logonStart = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$logonSync = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$dailySync = @()
foreach ($time in @('10:10 AM', '10:30 AM', '10:50 AM', '11:10 AM')) {
  $dailySync += New-ScheduledTaskTrigger -Daily -At $time
}
$weeklyBackup = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '6:00 PM'

$tasks = @(
  @{
    Name = 'Kapil Billing Start'
    Description = 'Starts local-only Kapil Billing when the owner signs in.'
    Action = New-KapilAction 'start-kapil.ps1' '-NoBrowser'
    Trigger = $logonStart
  },
  @{
    Name = 'Kapil Brass RSS Catch-up'
    Description = 'Backfills missed BrassB2B bulletins when the owner signs in.'
    Action = New-KapilAction 'sync-brass-rates.ps1'
    Trigger = $logonSync
  },
  @{
    Name = 'Kapil Brass RSS Daily'
    Description = 'Checks around the normal 10:30 AM bulletin window and exits once today is saved.'
    Action = New-KapilAction 'sync-brass-rates.ps1' '-LatestOnly'
    Trigger = $dailySync
  },
  @{
    Name = 'Kapil Billing Weekly Backup'
    Description = 'Creates a stopped-database backup Sunday at 6 PM with rotating retention.'
    Action = New-KapilAction 'backup-kapil.ps1' '-RecentCount 4 -WeeklyCount 8 -MonthlyCount 6'
    Trigger = $weeklyBackup
  }
)

foreach ($task in $tasks) {
  Register-ScheduledTask `
    -TaskName $task.Name `
    -Description $task.Description `
    -Action $task.Action `
    -Trigger $task.Trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null
}

Start-ScheduledTask -TaskName 'Kapil Billing Start'
Start-ScheduledTask -TaskName 'Kapil Brass RSS Catch-up'
Start-Sleep -Seconds 3

Write-Host ''
Write-Host 'Kapil automation installed successfully.' -ForegroundColor Green
Get-ScheduledTask | Where-Object { $_.TaskName -like 'Kapil *' } | Select-Object TaskName, State | Format-Table -AutoSize
Write-Host 'Close this window, then restart Windows once to verify startup.'
Read-Host 'Press Enter to close'
