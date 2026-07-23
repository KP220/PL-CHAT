$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$runner = Join-Path $PSScriptRoot 'windows-phase-g-storage-safety.cmd'
$taskName = 'PL CHAT Phase G Storage Safety'

if (!(Test-Path -LiteralPath $runner)) {
  throw "Runner not found: $runner"
}

Write-Host ''
Write-Host 'Installing PL CHAT Phase G Storage Safety scheduled task...' -ForegroundColor Cyan
Write-Host 'Default mode: dry-run safety report every day at 08:30.' -ForegroundColor Yellow

$action = New-ScheduledTaskAction -Execute $runner -Argument '--json'
$trigger = New-ScheduledTaskTrigger -Daily -At 8:30am
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'PL CHAT Phase G storage safety dry-run report: disk thresholds, abandoned uploads, and safe cleanup candidates.' `
  -Force | Out-Null

Write-Host 'Installed scheduled task:' -ForegroundColor Green
Write-Host "  $taskName" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Reports will be written to:' -ForegroundColor Green
Write-Host "  $(Join-Path $root 'pl-chat-data\storage-safety')" -ForegroundColor Cyan
Write-Host ''
Write-Host 'To run manually now:' -ForegroundColor Yellow
Write-Host "  $runner" -ForegroundColor Yellow
Write-Host ''
Write-Host 'To apply safe local cleanup after reviewing the report:' -ForegroundColor Yellow
Write-Host "  $runner --apply" -ForegroundColor Yellow
Write-Host ''
Write-Host 'Press any key to close...'
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
