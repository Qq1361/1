param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
Start-ScheduledTask -InputObject $task
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Seconds 1
  $state = (Get-ScheduledTask -TaskName $TaskName).State
} while ($state -eq "Running" -and (Get-Date) -lt $deadline)

$info = Get-ScheduledTaskInfo -TaskName $TaskName
if ($state -eq "Running") { throw "Task '$TaskName' did not finish before the timeout." }
if ($info.LastTaskResult -ne 0) { throw "Task '$TaskName' failed with LastTaskResult $($info.LastTaskResult)." }
Write-Output "Task '$TaskName' completed successfully."
