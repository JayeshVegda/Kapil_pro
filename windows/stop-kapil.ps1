. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories

foreach ($entry in @(@('caddy', $script:CaddyExe), @('pocketbase', $script:PocketBaseExe))) {
  $name = $entry[0]
  $expected = $entry[1]
  $process = Get-KapilProcess $name $expected
  if ($null -ne $process) {
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
    Write-KapilLog "$name stopped (PID $($process.Id))."
  }
  Remove-Item -LiteralPath (Get-KapilPidFile $name) -Force -ErrorAction SilentlyContinue
}
