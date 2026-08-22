param(
  [Parameter(Mandatory = $true)] [string]$WebAppUrl,
  [string]$SyncToken = '',
  [string]$PocketBaseUrl = 'http://127.0.0.1:8090',
  [string]$StateDir = 'C:\Site_imp\kapil-windows\JayeshVegda-Kapil_pro-49c561a\runtime\state'
)

$ErrorActionPreference = 'Stop'
$emailPath = Join-Path $StateDir 'pb-admin-email.txt'
$passwordPath = Join-Path $StateDir 'pb-admin-password.dpapi'

function Get-PbToken {
  $secure = Get-Content -LiteralPath $passwordPath -Raw | ConvertTo-SecureString
  $credential = New-Object Management.Automation.PSCredential((Get-Content -LiteralPath $emailPath -Raw).Trim(), $secure)
  try {
    $body = @{ identity = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
    return (Invoke-RestMethod -Method Post -Uri "$PocketBaseUrl/api/collections/_superusers/auth-with-password" -ContentType 'application/json' -Body $body -TimeoutSec 15).token
  } finally {
    $credential = $null
    $secure = $null
  }
}

function Get-PbAll([string]$Collection, [string]$Token, [string]$Sort = '') {
  $all = @()
  $page = 1
  do {
    $query = "page=$page&perPage=200&skipTotal=true"
    if ($Sort) { $query += "&sort=$([uri]::EscapeDataString($Sort))" }
    try {
      $result = Invoke-RestMethod -Uri "$PocketBaseUrl/api/collections/$Collection/records?$query" -Headers @{ Authorization = $Token } -TimeoutSec 30
    } catch {
      $detail = $_.ErrorDetails.Message
      throw "PocketBase collection '$Collection' failed: $detail"
    }
    $items = @($result.items)
    $all += $items
    $page++
  } while ($items.Count -eq 200)
  return $all
}

if (-not (Test-Path -LiteralPath $emailPath) -or -not (Test-Path -LiteralPath $passwordPath)) {
  throw 'PocketBase DPAPI credentials are missing.'
}
if (-not ([uri]::TryCreate($WebAppUrl, [UriKind]::Absolute, [ref]$null))) { throw 'WebAppUrl must be an absolute Apps Script web-app URL.' }

$token = Get-PbToken
$customers = Get-PbAll 'customers' $token 'name'
$bills = Get-PbAll 'bills' $token 'date,bill_no,id'
$billItems = Get-PbAll 'bill_items' $token ''
$payments = Get-PbAll 'payments' $token 'date,created,id'

$payload = @{
  version = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  token = $SyncToken
  customers = $customers
  bills = $bills
  billItems = $billItems
  payments = $payments
} | ConvertTo-Json -Depth 12 -Compress

$response = Invoke-RestMethod -Method Post -Uri $WebAppUrl -ContentType 'application/json' -Body $payload -TimeoutSec 120
if (-not $response.ok) { throw "Google Sheet sync rejected: $($response.error)" }
Write-Output ("Google Sheet sync complete: {0} bill-item rows, {1} payments, generated {2}" -f $response.bills, $response.payments, $response.generatedAt)
