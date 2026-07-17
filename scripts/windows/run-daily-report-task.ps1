param(
  [Parameter(Mandatory = $true)][string]$ProjectPath,
  [string]$PnpmPath = "pnpm.cmd",
  [string]$EnvironmentFilePath = ""
)

$ErrorActionPreference = "Stop"
$resolvedProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$logDirectory = Join-Path $resolvedProjectPath "logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory ("daily-business-report-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))

if ($EnvironmentFilePath) {
  $env:DAILY_REPORT_ENV_FILE = (Resolve-Path -LiteralPath $EnvironmentFilePath).Path
}

Push-Location $resolvedProjectPath
try {
  & $PnpmPath --dir $resolvedProjectPath send:daily-report *>> $logPath
  exit $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item Env:DAILY_REPORT_ENV_FILE -ErrorAction SilentlyContinue
}
