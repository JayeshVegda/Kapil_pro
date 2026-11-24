. (Join-Path $PSScriptRoot 'common.ps1')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open Windows PowerShell as Administrator.'
}
Assert-KapilFile (Join-Path $script:StateDir 'muse-purchase.key.sha256') 'Existing Muse API key digest'
Assert-KapilFile (Join-Path $script:StateDir 'muse-purchase-writer.clixml') 'Existing encrypted Muse writer login'
if (-not (Get-ScheduledTask -TaskName 'Kapil Muse Purchase' -ErrorAction SilentlyContinue)) {
  throw 'The original Muse connector is not installed. Run install-muse-purchase.ps1 first.'
}

# Check that the new gateway builds before taking the production database offline.
$node = Join-Path $script:BinDir 'node\node.exe'
Assert-KapilFile $node 'Bundled Node'
$env:RAYON_NUM_THREADS = '1'
& $node (Join-Path $script:ProjectRoot 'scripts\build-muse-purchase.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Connector build failed. The existing processes were not restarted.' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update-muse-purchase-database.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Database update did not finish. The Muse connector has not been restarted.' }

# The old password and key settings are kept, and the private HTTPS proxy isn't changed.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-muse-purchase.ps1') -SkipTailscale
if ($LASTEXITCODE -ne 0) { throw 'The gateway refresh did not finish. Send the output for review.' }
Write-Host 'Muse gateway updated. Keep the same private URL and API key. Casting draft access follows the Casting module setting.'
