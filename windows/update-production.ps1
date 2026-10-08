# Production Update Script for Kapil Billing
# Safely promotes tested code from GitHub 'main' into the official live system.

param(
    [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Kapil Billing - Production Update       " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Step 1: Pre-update Safety Backup
if (-not $SkipBackup) {
    Write-Host "[1/5] Taking pre-update safety backup..." -ForegroundColor Yellow
    $backupScript = Join-Path $PSScriptRoot 'backup-kapil.ps1'
    if (Test-Path $backupScript) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript -RecentCount 4 -WeeklyCount 8 -MonthlyCount 6
        Write-Host "  Pre-update backup completed." -ForegroundColor Green
    } else {
        Write-Warning "  Backup script not found, proceeding carefully."
    }
} else {
    Write-Host "[1/5] Skipping backup (-SkipBackup passed)." -ForegroundColor Gray
}

# Step 2: Fetch and pull latest main from GitHub
Write-Host "[2/5] Pulling latest updates from GitHub 'main'..." -ForegroundColor Yellow
git pull origin main
if ($LASTEXITCODE -ne 0) {
    throw "Git pull failed. Aborting update to protect production."
}
Write-Host "  Code updated to latest commit." -ForegroundColor Green

# Step 3: Install dependencies (if package.json updated)
Write-Host "[3/5] Verifying dependencies..." -ForegroundColor Yellow
npm install --prefer-offline --no-audit
Write-Host "  Dependencies verified." -ForegroundColor Green

# Step 4: Build production frontend
Write-Host "[4/5] Building production assets (dist)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed! Check errors above."
}
Write-Host "  Frontend successfully compiled." -ForegroundColor Green

# Step 5: Verify production health
Write-Host "[5/5] Verifying production health..." -ForegroundColor Yellow
Start-Sleep -Seconds 1
try {
    $pbHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8090/api/health" -TimeoutSec 5
    $caddyRes = Invoke-WebRequest -Uri "http://127.0.0.1:4174" -UseBasicParsing -TimeoutSec 5
    if ($caddyRes.StatusCode -eq 200 -and $pbHealth.code -eq 200) {
        Write-Host ""
        Write-Host "SUCCESS: Production update completed safely!" -ForegroundColor Green
        Write-Host "  • Official Site : http://127.0.0.1:4174 (Status: OK)" -ForegroundColor Green
        Write-Host "  • PocketBase    : http://127.0.0.1:8090 (Status: OK)" -ForegroundColor Green
        Write-Host "==========================================" -ForegroundColor Cyan
    } else {
        Write-Warning "App returned unexpected status. Please check logs."
    }
} catch {
    Write-Warning "Health check warning: $_"
}
