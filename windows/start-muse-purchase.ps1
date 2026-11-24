. (Join-Path $PSScriptRoot 'common.ps1')
Initialize-KapilDirectories
$nodeExe = Join-Path $script:BinDir 'node\node.exe'
$gateway = Join-Path $script:StateDir 'muse-purchase-api.mjs'
$keyPath = Join-Path $script:StateDir 'muse-purchase.key.sha256'
$credentialPath = Join-Path $script:StateDir 'muse-purchase-writer.clixml'
Assert-KapilFile $nodeExe 'Bundled Node'
Assert-KapilFile $gateway 'Built Purchase connector'
Assert-KapilFile $keyPath 'Purchase API key digest'

# Never pass credentials as command-line arguments or print them.
$savedEmail = [Environment]::GetEnvironmentVariable('KAPIL_MUSE_PURCHASE_EMAIL', 'Process')
$savedPassword = [Environment]::GetEnvironmentVariable('KAPIL_MUSE_PURCHASE_PASSWORD', 'Process')
try {
  Remove-Item Env:KAPIL_MUSE_PURCHASE_EMAIL,Env:KAPIL_MUSE_PURCHASE_PASSWORD -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
    $credential = Import-Clixml -LiteralPath $credentialPath
    $env:KAPIL_MUSE_PURCHASE_EMAIL = $credential.UserName
    $env:KAPIL_MUSE_PURCHASE_PASSWORD = $credential.GetNetworkCredential().Password
  }
  & $nodeExe $gateway
  exit $LASTEXITCODE
} finally {
  [Environment]::SetEnvironmentVariable('KAPIL_MUSE_PURCHASE_EMAIL', $savedEmail, 'Process')
  [Environment]::SetEnvironmentVariable('KAPIL_MUSE_PURCHASE_PASSWORD', $savedPassword, 'Process')
}
