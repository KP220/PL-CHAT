$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$runner = Join-Path $PSScriptRoot 'windows-phase-h-backup-dr.cmd'
$taskName = 'PL CHAT Phase H Backup DR'

if (!(Test-Path -LiteralPath $runner)) {
  throw "Runner not found: $runner"
}

Write-Host ''
Write-Host 'Installing PL CHAT Phase H Backup DR scheduled task...' -ForegroundColor Cyan
Write-Host 'Default mode: daily metadata/config/inventory backup at 09:00.' -ForegroundColor Yellow

$metadataRunner = Join-Path $PSScriptRoot 'windows-phase-h-metadata-backup.cmd'
$action = New-ScheduledTaskAction -Execute $metadataRunner
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00am
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
  -Description 'PL CHAT Phase H daily backup: metadata, redacted config, active upload inventory, checksum manifest.' `
  -Force | Out-Null

Write-Host 'Installed scheduled task:' -ForegroundColor Green
Write-Host "  $taskName" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Backups will be written to:' -ForegroundColor Green
Write-Host "  $(Join-Path $root '.backups\phase-h')" -ForegroundColor Cyan
Write-Host ''
Write-Host 'To run a metadata backup manually:' -ForegroundColor Yellow
Write-Host "  $runner --apply --metadata-only" -ForegroundColor Yellow
Write-Host ''
Write-Host 'To run a full local-upload backup to a chosen target:' -ForegroundColor Yellow
Write-Host "  $runner --apply --include-local-uploads --backup-root=D:\PLCHAT-BACKUPS" -ForegroundColor Yellow
