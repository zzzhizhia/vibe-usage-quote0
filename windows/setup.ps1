param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

. (Join-Path $PSScriptRoot 'common.ps1')

try {
  Protect-PrivateConfigAcl -Path $Path
  Assert-PrivateConfigAcl -Path $Path
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
