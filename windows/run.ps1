param(
  [string]$NodePath,
  [string]$CliPath,
  [ValidateSet('push', 'dry-run')]
  [string]$Command = 'push',
  [string]$LogPath
)

. (Join-Path $PSScriptRoot 'common.ps1')

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $resolvedNode = Get-CommandPath -Name @('node.exe', 'node')
} else {
  $resolvedNode = Resolve-ExecutablePath -Path $NodePath -CommandName @('node.exe', 'node')
}
if ([string]::IsNullOrWhiteSpace($CliPath)) {
  $resolvedCli = Get-CommandPath -Name @('vibe-usage-quote0.cmd', 'vibe-usage-quote0')
} else {
  $resolvedCli = Resolve-ExecutablePath -Path $CliPath -CommandName @('vibe-usage-quote0.cmd', 'vibe-usage-quote0')
}
if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path (Join-Path (Get-WindowsDataDirectory) 'logs') 'scheduled-task.log'
}
if (-not [IO.Path]::IsPathRooted($LogPath)) {
  throw "Log path must be absolute: $LogPath"
}

$logDirectory = Split-Path -Parent $LogPath
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$env:PATH = "$(Split-Path -Parent $resolvedNode);$env:PATH"
Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format o) command=$Command started"

$exitCode = 1
$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  & $resolvedCli $Command 1>$null 2>$null
  $exitCode = $LASTEXITCODE
} catch {
  $exitCode = 1
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format o) command=$Command exit_code=$exitCode"
exit $exitCode
