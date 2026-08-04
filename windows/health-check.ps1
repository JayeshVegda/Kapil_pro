. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories

$checks = @(
  @('PocketBase process', ($null -ne (Get-KapilProcess 'pocketbase' $script:PocketBaseExe))),
  @('Caddy process', ($null -ne (Get-KapilProcess 'caddy' $script:CaddyExe))),
  @('Database file', (Test-Path -LiteralPath (Join-Path $script:DataDir 'data.db'))),
  @('Frontend build', (Test-Path -LiteralPath (Join-Path $script:ProjectRoot 'dist\index.html')))
)
$failed = $false
foreach ($check in $checks) {
  $status = if ($check[1]) { 'OK' } else { $failed = $true; 'FAIL' }
  Write-Host ('{0,-24} {1}' -f $check[0], $status)
}
foreach ($endpoint in @('http://127.0.0.1:8090/api/health', 'http://127.0.0.1:4174')) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $endpoint -TimeoutSec 5
    Write-Host ('{0,-24} HTTP {1}' -f $endpoint, $response.StatusCode)
  } catch {
    $failed = $true
    Write-Host ('{0,-24} FAIL' -f $endpoint)
  }
}
if ($failed) { exit 1 }
