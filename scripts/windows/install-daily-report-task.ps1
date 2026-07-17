param(
  [string]$TaskName = "ResaleERP-DailyBusinessReport",
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$StartTime = "09:00",
  [string]$PnpmPath = "pnpm.cmd",
  [string]$EnvironmentFilePath = "",
  [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"
$resolvedProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$runnerPath = Join-Path $resolvedProjectPath "scripts\windows\run-daily-report-task.ps1"
if (-not (Test-Path -LiteralPath $runnerPath)) { throw "Daily report task runner was not found in the project." }
try { $at = [datetime]::Today.Add([timespan]::Parse($StartTime)) } catch { throw "StartTime must use HH:mm format." }

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and -not $ForceUpdate) { throw "A task named '$TaskName' already exists. Refusing to overwrite it." }
if ($existing -and $ForceUpdate -and $existing.Description -notlike "Resale ERP daily business report*") {
  throw "The existing task does not belong to Resale ERP. Refusing to overwrite it."
}

$arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $runnerPath), "-ProjectPath", ('"{0}"' -f $resolvedProjectPath), "-PnpmPath", ('"{0}"' -f $PnpmPath))
if ($EnvironmentFilePath) { $arguments += @("-EnvironmentFilePath", ('"{0}"' -f (Resolve-Path -LiteralPath $EnvironmentFilePath).Path)) }
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($arguments -join " ")
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15) -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Resale ERP daily business report. Sends yesterday's report once per day." -Force | Out-Null
Write-Output "Installed daily report task '$TaskName' at $StartTime using Windows local time."
