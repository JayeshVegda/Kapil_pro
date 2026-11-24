# Owner-run maintenance for the service-managed Windows deployment.
param([switch]$CheckOnly)
. (Join-Path $PSScriptRoot 'common.ps1')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $CheckOnly -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open Windows PowerShell as Administrator, then run this script again.'
}

$pbServiceName = 'KapilPocketBase'
$caddyServiceName = 'KapilCaddy'
$node = Join-Path $script:BinDir 'node\node.exe'
$db = Join-Path $script:DataDir 'data.db'
$migrations = @('1794640016_scope_purchase_payment_draft_reads.js', '1794640017_create_muse_purchase_action_drafts.js', '1794640018_muse_sales_draft_idempotency.js', '1794640019_link_muse_party_drafts.js', '1794640020_muse_review_and_party_creation.js')
Assert-KapilFile $node 'Bundled Node'
Assert-KapilFile $db 'Kapil database'
foreach ($file in $migrations) { Assert-KapilFile (Join-Path $script:ProjectRoot "pb_migrations\$file") 'Muse migration' }

$parameterPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$pbServiceName\Parameters"
$parameters = Get-ItemProperty -LiteralPath $parameterPath
$configuredExe = [IO.Path]::GetFullPath([string]$parameters.Application)
$migrationDir = Join-Path $script:ProjectRoot 'pb_migrations'
$hooksDir = Join-Path $script:ProjectRoot 'pb_hooks'
Assert-KapilFile (Join-Path $hooksDir 'muse_party_create.pb.js') 'Muse party and review hook'
$serviceArgs = [string]$parameters.AppParameters
if ($configuredExe -ine $script:PocketBaseExe -or
    $serviceArgs -notmatch ('--dir\s+"?' + [regex]::Escape($script:DataDir) + '(?:"|\s|$)') -or
    $serviceArgs -notmatch ('--migrationsDir\s+"?' + [regex]::Escape($migrationDir) + '(?:"|\s|$)')) {
  throw 'The PocketBase service points to another installation. No services were changed.'
}
$needsHookPath = $serviceArgs -notmatch '(?:^|\s)--hooksDir(?:\s|=)'
if (-not $needsHookPath -and $serviceArgs -notmatch ('--hooksDir[\s=]+"?' + [regex]::Escape($hooksDir) + '(?:"|\s|$)')) {
  throw 'PocketBase is configured with a different hooks directory. No services were changed.'
}

function Get-PendingMuseMigrations {
  $result = & $node -e "const d=new(require('node:sqlite').DatabaseSync)(process.argv[1],{readOnly:true}); try { const ok=d.prepare('select 1 from _migrations where file = ?'); console.log(JSON.stringify(process.argv.slice(2).filter(n=>!ok.get(n)))); } finally { d.close(); }" $db @migrations
  if ($LASTEXITCODE -ne 0) { throw 'Could not check the migration state.' }
  return ($result | ConvertFrom-Json)
}

$pending = @(Get-PendingMuseMigrations)
if ($pending.Count -eq 0 -and -not $needsHookPath) {
  Write-Host 'Muse database updates are already applied. Nothing was restarted.'
  return
}
if ($CheckOnly) {
  Write-Host ('Pending Muse database updates: ' + ($pending -join ', '))
  if ($needsHookPath) { Write-Host 'The Windows service needs its explicit project hooks path.' }
  return
}

$pb = Get-Service -Name $pbServiceName
$caddy = Get-Service -Name $caddyServiceName
if ($pb.Status -ne 'Running' -or $caddy.Status -ne 'Running') {
  throw 'Kapil is not in its normal running state. No services were changed.'
}

Write-Host 'Stopping Kapil briefly for an offline backup...'
Stop-Service -Name $caddyServiceName
$caddy.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
try {
  Stop-Service -Name $pbServiceName
  $pb.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
} catch {
  if ((Get-Service $pbServiceName).Status -eq 'Running') { Start-Service $caddyServiceName }
  throw
}
if (Get-NetTCPConnection -State Listen -LocalPort 8090,4174 -ErrorAction SilentlyContinue) {
  throw 'A Kapil port is still in use. No backup or restart was attempted. Send this output for review.'
}

$backupScript = Join-Path $PSScriptRoot 'backup-kapil.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -SkipRetention
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; Kapil was left stopped to avoid applying migrations without a backup. Send this output for review.' }

if ($needsHookPath) {
  Set-ItemProperty -LiteralPath $parameterPath -Name AppParameters -Value ($serviceArgs + ' --hooksDir "' + $hooksDir + '"')
}
Start-Service -Name $pbServiceName
$pb.WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
Wait-KapilUrl 'http://127.0.0.1:8090/api/health'
Start-Service -Name $caddyServiceName
$caddy.WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
Wait-KapilUrl 'http://127.0.0.1:4174'

$remaining = @(Get-PendingMuseMigrations)
if ($remaining.Count -gt 0) { throw ('Kapil restarted, but these migrations are still pending: ' + ($remaining -join ', ')) }
try {
  Invoke-WebRequest -Method Post -Body '{}' -ContentType 'application/json' -Uri 'http://127.0.0.1:8090/api/kapil/muse/create-party' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop | Out-Null
  throw 'The Muse party endpoint unexpectedly accepted a request without authentication.'
} catch {
  $response = $_.Exception.Response
  if (-not $response -or [int]$response.StatusCode -notin @(401, 403)) {
    throw 'Muse hook endpoint could not be verified after restart. The connector was not restarted.'
  }
}
Write-Host 'Kapil is healthy. All Muse database updates are applied.'
