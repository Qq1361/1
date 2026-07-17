param(
  [Parameter(Mandatory = $true)][string]$TaskName
)

$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Output "Task '$TaskName' does not exist."
  exit 0
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "Removed daily report task '$TaskName'."
