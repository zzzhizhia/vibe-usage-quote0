param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 44640)]
  [int]$IntervalMinutes
)

. (Join-Path $PSScriptRoot 'common.ps1')

try {
  $task = Get-ScheduledTask -TaskName $script:VibeUsageTaskName -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    Write-Output 'schedule_updated=false'
    exit 0
  }

  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
  Set-ScheduledTask `
    -TaskName $script:VibeUsageTaskName `
    -Trigger $trigger | Out-Null

  Write-Output 'schedule_updated=true'
  Write-Output "interval_minutes=$IntervalMinutes"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
