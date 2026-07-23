$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'windows-start-plchat-network-autostart.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 0)
Register-ScheduledTask -TaskName 'PL CHAT KAVEEP Assistant' -Action $action -Trigger $trigger -Settings $settings -Description 'Starts Local Qwen, ComfyUI, KAVEEP Assistant, and PL CHAT after sign-in.' -Force | Out-Null
Write-Host 'Installed: PL CHAT KAVEEP Assistant (At log on, 30 second delay).'
