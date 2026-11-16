param(
  [Parameter(Position=0)]
  [double]$Rate,

  [string]$Date = (Get-Date -Format 'yyyy-MM-dd')
)

$repo = 'C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a'
Set-Location $repo

if ($Rate -gt 0) {
  Write-Host "Setting brass market rate for $Date to ₹$Rate/kg..." -ForegroundColor Cyan
  & node scripts/update-market-rate.mjs --rate $Rate --date $Date
} else {
  Write-Host "Syncing brass market rate from Telegram feed and refreshing cache..." -ForegroundColor Cyan
  & node scripts/update-market-rate.mjs
}

if ($LASTEXITCODE -eq 0) {
  Write-Host "`nBrass market rate updated successfully!" -ForegroundColor Green
  Write-Host "Web app endpoint: http://127.0.0.1:4174/api/market-rate" -ForegroundColor Gray
} else {
  Write-Host "`nUpdate failed with code $LASTEXITCODE." -ForegroundColor Red
}
