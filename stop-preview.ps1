# Stop Kapil Preview Services (Port 8091 PocketBase)
Write-Host "Stopping Preview PocketBase on port 8091..." -ForegroundColor Yellow
$conn = Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Preview PocketBase stopped." -ForegroundColor Green
} else {
    Write-Host "No process listening on port 8091." -ForegroundColor Gray
}
