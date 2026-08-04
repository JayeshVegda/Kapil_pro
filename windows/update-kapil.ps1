. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories
if (Test-Path -LiteralPath (Join-Path $script:DataDir 'data.db')) { & (Join-Path $PSScriptRoot 'backup-kapil.ps1') | Out-Null }
& (Join-Path $PSScriptRoot 'stop-kapil.ps1')
Push-Location $script:ProjectRoot
try {
  $changes = @(& git.exe status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'Git status failed.' }
  if ($changes.Count -gt 0) { throw 'Working tree has uncommitted changes. Update stopped without overwriting them.' }
  & git.exe pull --ff-only origin kapil-windows
  if ($LASTEXITCODE -ne 0) { throw 'Git update failed; local files were not overwritten.' }
  $env:VITE_POCKETBASE_URL = '/pb'
  $env:VITE_MARKET_RATE_URL = '/api/market-rate'
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  & npm.cmd run verify
  if ($LASTEXITCODE -ne 0) { throw 'Verification failed; Kapil was not restarted.' }
} finally { Pop-Location }
& (Join-Path $PSScriptRoot 'start-kapil.ps1')
