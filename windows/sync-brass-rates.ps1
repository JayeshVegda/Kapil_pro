param([switch]$LatestOnly)

$ErrorActionPreference = 'Stop'
$repo = 'C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a'
$state = Join-Path $repo 'runtime\state'
$log = Join-Path $repo 'runtime\logs\brass-sync.log'
$emailPath = Join-Path $state 'pb-admin-email.txt'
$passwordPath = Join-Path $state 'pb-admin-password.dpapi'

function Write-SyncLog([string]$Message) {
  Add-Content -LiteralPath $log -Value ('[{0}] {1}' -f [DateTime]::Now.ToString('s'), $Message)
}

try {
  if (-not (Test-Path -LiteralPath $emailPath -PathType Leaf)) { throw 'PocketBase admin email configuration is missing.' }
  if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) { throw 'Encrypted PocketBase credential is missing.' }
  if (-not (Test-Path -LiteralPath (Join-Path $repo 'node_modules\pocketbase') -PathType Container)) { throw 'Required PocketBase JavaScript client is missing.' }

  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/health' -TimeoutSec 8
  if ([int]$health.code -ne 200) { throw 'PocketBase is not healthy.' }

  $secure = Get-Content -LiteralPath $passwordPath -Raw | ConvertTo-SecureString
  $credential = New-Object Management.Automation.PSCredential((Get-Content -LiteralPath $emailPath -Raw).Trim(), $secure)
  $env:PB_ADMIN_EMAIL = $credential.UserName
  $env:PB_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
  $env:PB_URL = 'http://127.0.0.1:8090'
  $env:BRASS_RSS_URL = 'https://rss.zayu.dev/telegram/channel/brassb2b'

  if ($LatestOnly) {
    $authBody = @{ identity = $env:PB_ADMIN_EMAIL; password = $env:PB_ADMIN_PASSWORD } | ConvertTo-Json
    $auth = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8090/api/collections/_superusers/auth-with-password' -ContentType 'application/json' -Body $authBody -TimeoutSec 10
    $today = [DateTime]::Today.ToString('yyyy-MM-dd')
    $tomorrow = [DateTime]::Today.AddDays(1).ToString('yyyy-MM-dd')
    $filter = [uri]::EscapeDataString("date >= `"$today`" && date < `"$tomorrow`"")
    $existing = Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/collections/brass_rates/records?page=1&perPage=1&filter=$filter" -Headers @{ Authorization = $auth.token } -TimeoutSec 10
    if ([int]$existing.totalItems -gt 0) {
      Write-SyncLog "Today's brass rate is already saved; RSS check skipped."
      exit 0
    }
  }

  $arguments = @((Join-Path $repo 'scripts\brass-rss-watch.mjs'), '--no-telegram', '--require-today')
  if (-not $LatestOnly) { $arguments = @((Join-Path $repo 'scripts\brass-rss-watch.mjs'), '--backfill', '--no-telegram') }
  & (Get-Command node.exe -ErrorAction Stop).Source @arguments
  if ($LASTEXITCODE -ne 0) { throw "RSS importer exited with code $LASTEXITCODE." }
  Write-SyncLog ('Sync succeeded in {0} mode.' -f $(if ($LatestOnly) { 'latest-only' } else { 'catch-up' }))
} catch {
  Write-SyncLog ('Sync failed: ' + $_.Exception.Message)
  exit 1
} finally {
  Remove-Item Env:PB_ADMIN_PASSWORD,Env:PB_ADMIN_EMAIL,Env:PB_URL,Env:BRASS_RSS_URL -ErrorAction SilentlyContinue
  $credential = $null
  $secure = $null
}
