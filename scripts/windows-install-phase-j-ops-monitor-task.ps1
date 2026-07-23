$ErrorActionPreference = 'Stop'

$runner = Join-Path $PSScriptRoot 'windows-phase-j-ops-monitor-scheduled.cmd'
$taskName = 'PL CHAT Phase J Ops Monitor'

if (!(Test-Path -LiteralPath $runner)) {
  throw "Runner not found: $runner"
}

Write-Host ''
Write-Host 'Installing PL CHAT Phase J Ops Monitor scheduled task...' -ForegroundColor Cyan
Write-Host 'Default mode: daily operational monitor at 09:15.' -ForegroundColor Yellow

$action = New-ScheduledTaskAction -Execute $runner
$trigger = New-ScheduledTaskTrigger -Daily -At 9:15am
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
  -Description 'PL CHAT Phase J daily ops monitor: health, backup, storage, security activation, and scheduled task visibility.' `
  -Force | Out-Null

Write-Host 'Installed scheduled task:' -ForegroundColor Green
Write-Host "  $taskName" -ForegroundColor Cyan
