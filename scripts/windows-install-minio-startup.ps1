param(
  [string] $MinioDir = "C:\minio",
  [string] $TaskName = "PL CHAT MinIO Portable Storage"
)

$ErrorActionPreference = "Stop"

$runnerPath = Join-Path $MinioDir "plchat-start-minio.ps1"
if (-not (Test-Path -LiteralPath $runnerPath)) {
  Write-Host "MinIO startup runner was not found: $runnerPath" -ForegroundColor Red
  Write-Host "Run scripts\windows-enable-minio-portable-storage.cmd once before installing the startup task." -ForegroundColor Yellow
  exit 2
}

Write-Host ""
Write-Host "Installing MinIO startup task for the current Windows user..." -ForegroundColor Cyan

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "MinIO startup task installed: $TaskName" -ForegroundColor Green
Write-Host "MinIO will start automatically when this Windows user logs in." -ForegroundColor Cyan
