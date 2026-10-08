# Start Kapil Preview / Sandbox Environment (Isolated from Production)
$ErrorActionPreference = 'Stop'
$PreviewRoot = $PSScriptRoot
$PbExe = Join-Path $PreviewRoot 'runtime\bin\pocketbase.exe'
$PbData = Join-Path $PreviewRoot 'runtime\data'
$PbMigrations = Join-Path $PreviewRoot 'pb_migrations'
$PbLog = Join-Path $PreviewRoot 'runtime\pocketbase.preview.log'

# 1. Start Sandbox PocketBase on Port 8091 if not running
$existingPb = Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue
if (-not $existingPb) {
    Write-Host "Starting Preview PocketBase on 127.0.0.1:8091..." -ForegroundColor Cyan
    $pbArgs = @('serve', '--dir', $PbData, '--http', '127.0.0.1:8091', '--migrationsDir', $PbMigrations)
    $pbProc = Start-Process -FilePath $PbExe -ArgumentList $pbArgs -WorkingDirectory $PreviewRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $PbLog -RedirectStandardError $PbLog
    Start-Sleep -Seconds 2
} else {
    Write-Host "Preview PocketBase is already listening on port 8091." -ForegroundColor Green
}

# 2. Wait for health check
try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:8091/api/health" -TimeoutSec 5
    Write-Host "Sandbox PocketBase is healthy!" -ForegroundColor Green
} catch {
    Write-Warning "Waiting for PocketBase..."
}

# 3. Open browser & start Vite dev server
Write-Host "Starting Preview Frontend on http://127.0.0.1:5173..." -ForegroundColor Cyan
Start-Process "http://127.0.0.1:5173"
$env:VITE_POCKETBASE_TARGET = 'http://127.0.0.1:8091'
npm run dev
