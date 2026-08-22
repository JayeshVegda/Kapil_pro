param([switch]$SkipDownloads, [switch]$SkipBuild)
. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Initialize-KapilDirectories
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This package currently supports 64-bit Windows (AMD64) only.' }
$driveRoot = [System.IO.Path]::GetPathRoot($script:ProjectRoot)
$drive = Get-PSDrive -Name $driveRoot.Substring(0, 1)
if ($drive.Free -lt 5GB) { throw 'At least 5 GB free disk space is required for setup and safe backups.' }
if ($null -eq (Get-KapilProcess 'pocketbase' $script:PocketBaseExe)) { Assert-KapilPortFree 8090 'PocketBase' }
if ($null -eq (Get-KapilProcess 'caddy' $script:CaddyExe)) { Assert-KapilPortFree 4174 'Caddy' }

function Install-GitHubExecutable([string]$Repository, [string]$AssetPattern, [string]$ExecutableName) {
  $release = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'Kapil-Windows-Setup' } -Uri "https://api.github.com/repos/$Repository/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -match $AssetPattern } | Select-Object -First 1
  if ($null -eq $asset) { throw "No matching Windows amd64 asset found for $Repository" }
  $zip = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zip
  if ((Get-Item -LiteralPath $zip).Length -lt 1000000) { throw "Downloaded archive is unexpectedly small: $zip" }
  $extract = Join-Path $env:TEMP ("kapil-extract-" + [Guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $zip -DestinationPath $extract
  $exe = Get-ChildItem -LiteralPath $extract -Recurse -Filter $ExecutableName | Select-Object -First 1
  if ($null -eq $exe) { throw "$ExecutableName not found in downloaded archive." }
  Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $script:BinDir $ExecutableName) -Force
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $script:BinDir $ExecutableName)).Hash.ToLowerInvariant()
  Add-Content -LiteralPath (Join-Path $script:StateDir 'installed-versions.txt') -Value "$Repository $($release.tag_name) $hash"
  Remove-Item -LiteralPath $extract -Recurse -Force
  Remove-Item -LiteralPath $zip -Force
}

if (-not $SkipDownloads) {
  Install-GitHubExecutable 'pocketbase/pocketbase' 'windows_amd64\.zip$' 'pocketbase.exe'
  Install-GitHubExecutable 'caddyserver/caddy' 'windows_amd64\.zip$' 'caddy.exe'
}
Assert-KapilFile $script:PocketBaseExe 'PocketBase executable'
Assert-KapilFile $script:CaddyExe 'Caddy executable'

if (-not $SkipBuild) {
  if ($null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js LTS is required for initial setup. Install it from https://nodejs.org/ and rerun setup.' }
  Push-Location $script:ProjectRoot
  try {
    $env:VITE_POCKETBASE_URL = '/pb'
    $env:VITE_MARKET_RATE_URL = '/api/market-rate'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  } finally { Pop-Location }
}

& (Join-Path $PSScriptRoot 'start-kapil.ps1') -NoBrowser
Write-Host ''
Write-Host 'Windows runtime is ready.' -ForegroundColor Green
Write-Host 'For a fresh database, open http://127.0.0.1:8090/_/ once to create the PocketBase superuser.'
Write-Host 'For production migration, follow WINDOWS-SETUP.md and restore the verified transfer zip.'
