$Root = "C:\Users\PC\Documents\Codex\2026-05-28\ios"
$HealthUrl = "http://127.0.0.1:8788/api/health"
$LogDir = Join-Path $Root "pl-chat-data\watchdog"
$LogFile = Join-Path $LogDir "plchat-watchdog.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($Message) {
  $Line = "$(Get-Date -Format "yyyy-MM-dd HH:mm:ss") $Message"
  Add-Content -Path $LogFile -Value $Line -Encoding UTF8
  Write-Host $Line
}

function Test-PLChatHealth {
  try {
    $Result = Invoke-RestMethod $HealthUrl -TimeoutSec 5
    return ($Result.ok -eq $true)
  } catch {
    return $false
  }
}

function Stop-PLChatPort {
  $ports = @(8788)
  foreach ($port in $ports) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        Write-Log "Stopping stale server PID $_ on port $port"
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  }
}

function Start-PLChatServer {
  Write-Log "Starting PL CHAT production server..."

  $Command = @"
`$env:APP_PUBLIC_URL='http://192.168.1.117:8788'
`$env:S3_PUBLIC_BASE_URL='http://192.168.1.117:9000'
`$env:ENABLE_MULTIPART_UPLOAD='true'
`$env:S3_PUBLIC_TRANSFER_READY='true'
Set-Location '$Root'
& '.\scripts\windows-start-pl-chat-production.ps1'
"@

  Start-Process powershell.exe `
    -WorkingDirectory $Root `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $Command)
}

Write-Log "PL CHAT Watchdog started."

$FailCount = 0

while ($true) {
  if (Test-PLChatHealth) {
    if ($FailCount -gt 0) {
      Write-Log "Health recovered."
    }
    $FailCount = 0
  } else {
    $FailCount++
    Write-Log "Health failed count=$FailCount"

    if ($FailCount -ge 3) {
      Write-Log "Server seems down. Restarting..."
      Stop-PLChatPort
      Start-Sleep -Seconds 3
      Start-PLChatServer
      Start-Sleep -Seconds 20
      $FailCount = 0
    }
  }

  Start-Sleep -Seconds 20
}
