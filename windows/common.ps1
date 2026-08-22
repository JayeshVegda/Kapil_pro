Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:RuntimeDir = Join-Path $script:ProjectRoot 'runtime'
$script:BinDir = Join-Path $script:RuntimeDir 'bin'
$script:DataDir = Join-Path $script:RuntimeDir 'data'
$script:BackupDir = Join-Path $script:RuntimeDir 'backups'
$script:LogDir = Join-Path $script:RuntimeDir 'logs'
$script:StateDir = Join-Path $script:RuntimeDir 'state'
$script:TransferDir = Join-Path $script:RuntimeDir 'transfer'
$script:PocketBaseExe = Join-Path $script:BinDir 'pocketbase.exe'
$script:CaddyExe = Join-Path $script:BinDir 'caddy.exe'

function Initialize-KapilDirectories {
  @($script:RuntimeDir, $script:BinDir, $script:DataDir, $script:BackupDir, $script:LogDir, $script:StateDir, $script:TransferDir) | ForEach-Object {
    if (-not (Test-Path -LiteralPath $_)) { New-Item -ItemType Directory -Path $_ | Out-Null }
  }
}

function Write-KapilLog([string]$Message) {
  Initialize-KapilDirectories
  $line = '[{0}] {1}' -f ([DateTime]::Now.ToString('s')), $Message
  Add-Content -LiteralPath (Join-Path $script:LogDir 'operations.log') -Value $line
  Write-Host $line
}

function Get-KapilPidFile([string]$Name) { return Join-Path $script:StateDir ($Name + '.pid') }

function Get-KapilProcess([string]$Name, [string]$ExpectedExecutable) {
  $pidFile = Get-KapilPidFile $Name
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $recordedPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$recordedPid)) { return $null }
  $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  try { $actual = [System.IO.Path]::GetFullPath($process.Path) } catch { return $null }
  if ($actual -ne [System.IO.Path]::GetFullPath($ExpectedExecutable)) { return $null }
  return $process
}

function Test-KapilRunning {
  return ($null -ne (Get-KapilProcess 'pocketbase' $script:PocketBaseExe)) -or ($null -ne (Get-KapilProcess 'caddy' $script:CaddyExe))
}

function Wait-KapilUrl([string]$Url, [int]$Attempts = 30) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
    } catch {
      if ($attempt -eq $Attempts) { throw "Timed out waiting for $Url" }
    }
    Start-Sleep -Seconds 1
  }
}

function Assert-KapilFile([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label not found: $Path" }
}

function Assert-KapilPortFree([int]$Port, [string]$ServiceName) {
  if ($null -eq (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return }
  $owner = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $owner) { throw "Port $Port is already used by PID $($owner.OwningProcess); cannot safely start $ServiceName." }
}
