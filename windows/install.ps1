param(
  [switch]$DryRun,
  [string]$NodePath,
  [string]$CliPath,
  [string]$ConfigPath
)

. (Join-Path $PSScriptRoot 'common.ps1')

try {
  if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Get-WindowsQuoteConfigPath
  }
  Assert-QuoteConfigAcl -Path $ConfigPath

  $resolvedNode = Resolve-ExecutablePath -Path $NodePath -CommandName @('node.exe', 'node')
  $resolvedCli = Resolve-ExecutablePath -Path $CliPath -CommandName @('vibe-usage-quote0.cmd', 'vibe-usage-quote0')
  $env:PATH = "$(Split-Path -Parent $resolvedNode);$env:PATH"

  & $resolvedCli doctor
  $doctorExitCode = $LASTEXITCODE
  if ($doctorExitCode -ne 0) {
    throw "doctor failed with exit code $doctorExitCode; the scheduled task was not changed."
  }

  $powerShellPath = Join-Path $PSHOME 'powershell.exe'
  if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
    throw "Windows PowerShell executable not found: $powerShellPath"
  }
  $runnerPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run.ps1'))
  $actionArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}" -CliPath "{2}"' -f $runnerPath, $resolvedNode, $resolvedCli
  $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $actionArguments
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Seconds 1800)
  $principal = New-ScheduledTaskPrincipal `
    -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
  $definition = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Refresh the Vibe Usage Quote/0 Canvas every 30 minutes.'

  if ($DryRun) {
    Write-Output 'dry_run=true'
    Write-Output "task_name=$script:VibeUsageTaskName"
    Write-Output 'interval_seconds=1800'
    exit 0
  }

  Register-ScheduledTask `
    -TaskName $script:VibeUsageTaskName `
    -InputObject $definition `
    -Force | Out-Null
  Write-Output "installed_task=$script:VibeUsageTaskName"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
