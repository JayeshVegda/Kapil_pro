param([Parameter(Mandatory = $true)][string]$Archive, [switch]$NoStart)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories
$resolvedArchive = [System.IO.Path]::GetFullPath($Archive)
Assert-KapilFile $resolvedArchive 'Restore archive'
if ([System.IO.Path]::GetExtension($resolvedArchive) -ne '.zip') { throw 'Restore archive must be a .zip file.' }
if ((Get-Item -LiteralPath $resolvedArchive).Length -lt 100000) { throw 'Restore archive is unexpectedly small.' }

$hadDatabase = Test-Path -LiteralPath (Join-Path $script:DataDir 'data.db')
if ($hadDatabase) { & (Join-Path $PSScriptRoot 'backup-kapil.ps1') -SkipRetention | Out-Null }
& (Join-Path $PSScriptRoot 'stop-kapil.ps1')

$stamp = [DateTime]::Now.ToString('yyyyMMdd-HHmmss')
$staging = Join-Path $script:RuntimeDir ("restore-staging-$stamp")
$rollback = Join-Path $script:RuntimeDir ("data-before-restore-$stamp")
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $staging
  $candidate = Join-Path $staging 'data.db'
  if (-not (Test-Path -LiteralPath $candidate)) {
    $nested = Join-Path $staging 'data\data.db'
    if (Test-Path -LiteralPath $nested) { $staging = Join-Path $staging 'data'; $candidate = $nested }
  }
  Assert-KapilFile $candidate 'Database inside restore archive'
  if (Test-Path -LiteralPath $script:DataDir) { Move-Item -LiteralPath $script:DataDir -Destination $rollback }
  Move-Item -LiteralPath $staging -Destination $script:DataDir
  if (-not $NoStart) {
    & (Join-Path $PSScriptRoot 'start-kapil.ps1') -NoBrowser
    & (Join-Path $PSScriptRoot 'health-check.ps1')
  }
  Write-KapilLog "Restore completed from $resolvedArchive. Previous data retained at $rollback"
} catch {
  Write-KapilLog "Restore failed: $($_.Exception.Message)"
  throw
}
