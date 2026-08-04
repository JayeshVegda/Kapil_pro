param([switch]$NoBrowser)
. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories
Assert-KapilFile $script:PocketBaseExe 'PocketBase executable'
Assert-KapilFile $script:CaddyExe 'Caddy executable'
Assert-KapilFile (Join-Path $script:ProjectRoot 'dist\index.html') 'Built frontend'

if ($null -eq (Get-KapilProcess 'pocketbase' $script:PocketBaseExe)) {
  Assert-KapilPortFree 8090 'PocketBase'
  $pbOut = Join-Path $script:LogDir 'pocketbase.out.log'
  $pbErr = Join-Path $script:LogDir 'pocketbase.err.log'
  $pbArgs = @('serve', '--dir', $script:DataDir, '--http', '127.0.0.1:8090', '--migrationsDir', (Join-Path $script:ProjectRoot 'pb_migrations'))
  $pb = Start-Process -FilePath $script:PocketBaseExe -ArgumentList $pbArgs -WorkingDirectory $script:ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $pbOut -RedirectStandardError $pbErr -PassThru
  Set-Content -LiteralPath (Get-KapilPidFile 'pocketbase') -Value $pb.Id
  Write-KapilLog "PocketBase started (PID $($pb.Id))."
}
Wait-KapilUrl 'http://127.0.0.1:8090/api/health'

if ($null -eq (Get-KapilProcess 'caddy' $script:CaddyExe)) {
  Assert-KapilPortFree 4174 'Caddy'
  $env:KAPIL_DIST_DIR = (Join-Path $script:ProjectRoot 'dist').Replace('\', '/')
  $caddyOut = Join-Path $script:LogDir 'caddy.out.log'
  $caddyErr = Join-Path $script:LogDir 'caddy.err.log'
  $caddyArgs = @('run', '--config', (Join-Path $PSScriptRoot 'Caddyfile'), '--adapter', 'caddyfile')
  $caddy = Start-Process -FilePath $script:CaddyExe -ArgumentList $caddyArgs -WorkingDirectory $script:ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $caddyOut -RedirectStandardError $caddyErr -PassThru
  Set-Content -LiteralPath (Get-KapilPidFile 'caddy') -Value $caddy.Id
  Write-KapilLog "Caddy started (PID $($caddy.Id))."
}
Wait-KapilUrl 'http://127.0.0.1:4174'
Write-KapilLog 'Kapil Billing is healthy at http://127.0.0.1:4174'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4174' }
