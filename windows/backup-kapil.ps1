param([switch]$SkipRetention)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories

$database = Join-Path $script:DataDir 'data.db'
Assert-KapilFile $database 'PocketBase database'
$wasRunning = Test-KapilRunning
if ($wasRunning) { & (Join-Path $PSScriptRoot 'stop-kapil.ps1') }

$stamp = [DateTime]::Now.ToString('yyyyMMdd-HHmmss')
$archive = Join-Path $script:BackupDir ("kapil-local-$stamp.zip")
try {
  Compress-Archive -Path (Join-Path $script:DataDir '*') -DestinationPath $archive -CompressionLevel Optimal
  if ((Get-Item -LiteralPath $archive).Length -lt 100000) { throw 'Backup archive is unexpectedly small.' }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  Set-Content -LiteralPath ($archive + '.sha256.txt') -Value "$hash  $([System.IO.Path]::GetFileName($archive))"
  Write-KapilLog "Backup created: $archive (SHA-256 $hash)"
} finally {
  if ($wasRunning) { & (Join-Path $PSScriptRoot 'start-kapil.ps1') -NoBrowser }
}

if (-not $SkipRetention) {
  $files = @(Get-ChildItem -LiteralPath $script:BackupDir -Filter 'kapil-local-*.zip' | Sort-Object LastWriteTime -Descending)
  $keep = New-Object 'System.Collections.Generic.HashSet[string]'
  $files | Select-Object -First 14 | ForEach-Object { [void]$keep.Add($_.FullName) }
  $calendar = [System.Globalization.CultureInfo]::InvariantCulture.Calendar
  $files | Group-Object { '{0}-{1:D2}' -f $_.LastWriteTime.Year, $calendar.GetWeekOfYear($_.LastWriteTime, 2, 1) } | Select-Object -First 8 | ForEach-Object { [void]$keep.Add($_.Group[0].FullName) }
  $files | Group-Object { $_.LastWriteTime.ToString('yyyy-MM') } | Select-Object -First 12 | ForEach-Object { [void]$keep.Add($_.Group[0].FullName) }
  foreach ($file in $files) {
    if (-not $keep.Contains($file.FullName)) {
      Remove-Item -LiteralPath $file.FullName -Force
      Remove-Item -LiteralPath ($file.FullName + '.sha256.txt') -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Output $archive
