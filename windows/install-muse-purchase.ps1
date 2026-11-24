param(
  [switch]$ReadOnly,
  [switch]$RotateApiKey,
  [switch]$SkipTailscale,
  [switch]$UpdateWriterLogin
)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories

$account = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($account)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from elevated Windows PowerShell, signed in as the same Windows user who runs Kapil.'
}
$task = 'Kapil Muse Purchase'
$previous = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
$digestPath = Join-Path $script:StateDir 'muse-purchase.key.sha256'
$credentialPath = Join-Path $script:StateDir 'muse-purchase-writer.clixml'
$nodeExe = Join-Path $script:BinDir 'node\node.exe'
Assert-KapilFile $nodeExe 'Bundled Node'

if (-not $ReadOnly -and ($UpdateWriterLogin -or -not (Test-Path -LiteralPath $credentialPath -PathType Leaf))) {
  $email = 'muse@kapil.cosearch.me'
  $password = Read-Host 'Enter the existing PocketBase MUSE account password (not the administrator password)' -AsSecureString
  $credential = [System.Management.Automation.PSCredential]::new($email, $password)
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/collections/users/auth-with-password' -Method Post -ContentType 'application/json' -TimeoutSec 8 -Body (@{ identity = $email; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress)
    if ($response.record.role -ne 'muse' -or -not $response.token) { throw 'Not the Muse role.' }
  } catch {
    throw 'Could not verify the normal Muse account on this PC. Check PocketBase is running and use its Muse password, or run with -ReadOnly.'
  } finally {
    $response = $null
  }
  # Current-user Windows DPAPI; the task must run under this same Windows account.
  $credential | Export-Clixml -LiteralPath $credentialPath
}
if ($ReadOnly -and (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
  throw 'A writer login is already configured. Read-only setup will not silently erase it.'
}

$freshKey = $null
if ($RotateApiKey -or -not (Test-Path -LiteralPath $digestPath -PathType Leaf)) {
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = New-Object byte[] 32
    $random.GetBytes($bytes)
    $freshKey = 'kmp_' + [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($freshKey))).Replace('-', '').ToLowerInvariant()
    [IO.File]::WriteAllText($digestPath, $digest, [Text.Encoding]::ASCII)
  } finally { $random.Dispose(); $sha.Dispose() }
}

$env:RAYON_NUM_THREADS = '1'
& $nodeExe (Join-Path $script:ProjectRoot 'scripts\build-muse-purchase.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not build the Purchase connector.' }

if ($previous -and $previous.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $task
  for ($i = 0; $i -lt 12; $i++) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort 4796 -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort 4796 -ErrorAction SilentlyContinue) {
  throw 'Port 4796 is already in use. No existing process was terminated.'
}
$launcher = Join-Path $PSScriptRoot 'start-muse-purchase.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $launcher) -WorkingDirectory $script:ProjectRoot
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account.Name
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -User $account.Name -Description 'Local-only Kapil Purchase API for the private Muse connector' -Force | Out-Null
Start-ScheduledTask -TaskName $task

$listener = $null
for ($i = 0; $i -lt 30 -and -not $listener; $i++) {
  $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 4796 -State Listen -ErrorAction SilentlyContinue
  if (-not $listener) { Start-Sleep -Milliseconds 250 }
}
if (-not $listener) { throw 'The connector did not open its loopback listener.' }

if ($freshKey) {
  Write-Host 'Purchase API key (shown once). Enter it only in the Muse secure API-key setup:'
  Write-Host $freshKey
  $freshKey = $null
}
if (-not $SkipTailscale) {
  $tailscale = Get-Command tailscale.exe -ErrorAction Stop
  $serveStatus = & $tailscale.Source serve status --json
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Tailscale Serve. The local service is running.' }
  $serveConfig = ($serveStatus -join [Environment]::NewLine) | ConvertFrom-Json
  $hostEntry = if ($serveConfig -and $serveConfig.PSObject.Properties['Web']) {
    $serveConfig.Web.PSObject.Properties | Where-Object Name -Like '*:8443' | Select-Object -First 1
  }
  if ($serveConfig -and $serveConfig.PSObject.Properties['AllowFunnel'] -and
      ($serveConfig.AllowFunnel.PSObject.Properties | Where-Object { $_.Name -like '*:8443' -and $_.Value })) {
    throw 'Port 8443 is marked for public Funnel. Do not publish this connector there.'
  }
  if (-not $hostEntry -and $serveConfig -and $serveConfig.PSObject.Properties['TCP'] -and $serveConfig.TCP.PSObject.Properties['8443']) {
    throw 'Port 8443 is being used by a different Tailscale service. It was not changed.'
  }
  if ($hostEntry) {
    $handlers = $hostEntry.Value.Handlers.PSObject.Properties
    if (@($handlers).Count -ne 1 -or $handlers.Name -ne '/' -or $handlers.Value.Proxy -ne 'http://127.0.0.1:4796') {
      throw 'Private HTTPS port 8443 is being used by a different Tailscale service. It was not changed.'
    }
  } else {
    & $tailscale.Source serve --bg --https=8443 'http://127.0.0.1:4796'
    if ($LASTEXITCODE -ne 0) { throw 'Private HTTPS was not enabled. Complete the Tailscale consent step and rerun setup.' }
  }
  & $tailscale.Source serve status
} else {
  Write-Host 'Private HTTPS configuration was left unchanged. The gateway itself listens only on 127.0.0.1:4796.'
}
Write-Host ('Installed task: ' + $task + '. Starts at Windows logon.')
