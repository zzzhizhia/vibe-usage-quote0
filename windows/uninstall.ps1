. (Join-Path $PSScriptRoot 'common.ps1')

try {
  $task = Get-ScheduledTask -TaskName $script:VibeUsageTaskName -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    Write-Output "task_absent=$script:VibeUsageTaskName"
    exit 0
  }

  Unregister-ScheduledTask -TaskName $script:VibeUsageTaskName -Confirm:$false
  Write-Output "uninstalled_task=$script:VibeUsageTaskName"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
