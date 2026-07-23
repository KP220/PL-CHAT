$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$envPath = Join-Path $root '.env.production'
$statusDir = Join-Path $root 'pl-chat-data\tunnels'
$statusPath = Join-Path $root 'pl-chat-data\public-tunnel-url.txt'
$jsonStatusPath = Join-Path $statusDir 'quick-tunnel-status.json'
$appPort = 8788
$minioPort = 9000
$runStamp = '{0}-{1}' -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmssfff'), $PID
$mutex = $null
$mutexAcquired = $false

function Read-EnvValue {
  param([string]$Name, [string]$Default = '')
  if (!(Test-Path -LiteralPath $envPath)) { return $Default }
  $match = Select-String -LiteralPath $envPath -Pattern "^$([regex]::Escape($Name))=" | Select-Object -First 1
  if (!$match) { return $Default }
  return ($match.Line -split '=', 2)[1].Trim().Trim('"')
}

function Set-EnvValues {
  param([hashtable]$Values)
  $lines = if (Test-Path -LiteralPath $envPath) { @(Get-Content -LiteralPath $envPath) } else { @() }
  foreach ($name in $Values.Keys) {
    $updated = $false
    $lines = @($lines | ForEach-Object {
      if ($_ -match "^$([regex]::Escape($name))=") {
        $updated = $true
        "$name=`"$($Values[$name])`""
      } else {
        $_
      }
    })
    if (!$updated) { $lines += "$name=`"$($Values[$name])`"" }
  }
  Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8
}

function Wait-HttpReady {
  param([string]$Url, [int]$Seconds = 30)
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 750
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Stop-RecordedTunnel {
  param([string]$Name)
  $pidPath = Join-Path $statusDir "$Name.pid"
  if (!(Test-Path -LiteralPath $pidPath)) { return }
  $oldPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($oldPid -match '^\d+$') {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

function Test-ProcessRunning {
  param([int]$ProcessId)
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Get-ListeningPidsForPort {
  param([int]$Port)
  $ids = @()
  foreach ($line in (netstat -ano | Select-String ":$Port")) {
    $parts = ($line.Line -split '\s+') | Where-Object { $_ }
    if ($parts.Count -ge 5 -and $parts[1] -match ":$Port$" -and $parts[3] -eq 'LISTENING' -and $parts[-1] -match '^\d+$') {
      $ids += [int]$parts[-1]
    }
  }
  return @($ids | Select-Object -Unique)
}

function Start-QuickTunnel {
  param(
    [string]$Name,
    [string]$Origin,
    [System.Management.Automation.CommandInfo]$Cloudflared,
    [ValidateSet('quic', 'http2')][string]$Protocol = 'quic'
  )
  $outPath = Join-Path $statusDir "$Name-$runStamp.out.log"
  $errPath = Join-Path $statusDir "$Name-$runStamp.err.log"
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $Cloudflared.Source
  $startInfo.Arguments = "tunnel --no-autoupdate --protocol $Protocol --edge-ip-version 4 --loglevel info --url `"$Origin`""
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $process.EnableRaisingEvents = $true
  $stdoutWriter = [System.IO.StreamWriter]::new($outPath, $true, [System.Text.Encoding]::UTF8)
  $stderrWriter = [System.IO.StreamWriter]::new($errPath, $true, [System.Text.Encoding]::UTF8)
  $stdoutEvent = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action {
    if ($EventArgs.Data) {
      $Event.MessageData.WriteLine($EventArgs.Data)
      $Event.MessageData.Flush()
    }
  } -MessageData $stdoutWriter
  $stderrEvent = Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action {
    if ($EventArgs.Data) {
      $Event.MessageData.WriteLine($EventArgs.Data)
      $Event.MessageData.Flush()
    }
  } -MessageData $stderrWriter
  if (!$process.Start()) { throw "Could not start $Name Quick Tunnel." }
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  Set-Content -LiteralPath (Join-Path $statusDir "$Name.pid") -Value $process.Id -Encoding ASCII

  try {
    $deadline = (Get-Date).AddSeconds(60)
    do {
      if ($process.HasExited) {
        $errorText = if (Test-Path -LiteralPath $errPath) { Get-Content -Raw -LiteralPath $errPath } else { '' }
        throw "$Name Quick Tunnel stopped before returning a URL. $errorText"
      }
      $text = @(
        if (Test-Path -LiteralPath $outPath) { Get-Content -Raw -LiteralPath $outPath }
        if (Test-Path -LiteralPath $errPath) { Get-Content -Raw -LiteralPath $errPath }
      ) -join "`n"
      if ($text -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') {
        return [pscustomobject]@{
          Name = $Name
          Origin = $Origin
          Url = $Matches[0].TrimEnd('/')
          Process = $process
          StdoutEvent = $stdoutEvent
          StderrEvent = $stderrEvent
          StdoutWriter = $stdoutWriter
          StderrWriter = $stderrWriter
        }
      }
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "$Name Quick Tunnel did not return a public URL within 60 seconds."
  } catch {
    Unregister-Event -SubscriptionId $stdoutEvent.Id -ErrorAction SilentlyContinue
    Unregister-Event -SubscriptionId $stderrEvent.Id -ErrorAction SilentlyContinue
    $stdoutWriter.Dispose()
    $stderrWriter.Dispose()
    throw
  }
}

function Restart-PlChat {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedAppUrl,
    [Parameter(Mandatory = $true)][string]$ExpectedMinioUrl
  )
  $listenerPids = Get-ListeningPidsForPort -Port $appPort
  foreach ($listenerPid in $listenerPids) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    if (!((Get-ListeningPidsForPort -Port $appPort).Count)) { break }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  $remainingPids = Get-ListeningPidsForPort -Port $appPort
  if ($remainingPids.Count) {
    throw "Could not stop the old PL CHAT server on port $appPort. Close the old PL CHAT Production window manually, then run this launcher again. Remaining PID(s): $($remainingPids -join ', ')"
  }
  $startCmd = Join-Path $PSScriptRoot 'windows-start-pl-chat-production.cmd'
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$startCmd`"") -WorkingDirectory $root -WindowStyle Hidden
  if (!(Wait-HttpReady -Url "http://localhost:$appPort/api/health" -Seconds 45)) {
    throw 'PL CHAT did not become healthy after applying the Quick Tunnel URLs.'
  }
  Write-Host "PL CHAT restarted after applying the new Quick Tunnel URLs." -ForegroundColor Green
  Write-Host "Run windows-phase-l-quick-tunnel-acceptance.cmd to verify CORS, MinIO signed transfer, login, and SSE through the tunnel." -ForegroundColor Yellow
}

function Configure-MinioTransferCors {
  param([Parameter(Mandatory = $true)][string]$AppUrl)
  Write-Host 'MinIO bucket CORS update skipped for this portable MinIO build.' -ForegroundColor DarkYellow
  Write-Host 'Signed downloads use the MinIO transfer tunnel first; PL CHAT stream fallback remains enabled.' -ForegroundColor DarkCyan
}

New-Item -ItemType Directory -Path $statusDir -Force | Out-Null
Start-Transcript -LiteralPath (Join-Path $statusDir 'dual-tunnel-launcher.log') -Append | Out-Null
$configuredPort = Read-EnvValue -Name 'PL_CHAT_PORT' -Default '8788'
if ($configuredPort -match '^\d+$') { $appPort = [int]$configuredPort }

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (!$cloudflared) {
  $knownPath = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  if (Test-Path -LiteralPath $knownPath) { $cloudflared = Get-Command $knownPath }
}
if (!$cloudflared) { throw 'cloudflared is not installed.' }

if (!(Wait-HttpReady -Url "http://localhost:$minioPort/minio/health/live" -Seconds 5)) {
  throw "MinIO is not ready on http://localhost:$minioPort. Start MinIO first."
}
if (!(Wait-HttpReady -Url "http://localhost:$appPort/api/health" -Seconds 5)) {
  throw "PL CHAT is not ready on http://localhost:$appPort. Start PL CHAT first."
}

Stop-RecordedTunnel -Name 'plchat-app'
Stop-RecordedTunnel -Name 'plchat-minio'

$appTunnel = $null
$minioTunnel = $null
try {
  Write-Host ''
  Write-Host 'Starting PL CHAT dual Quick Tunnel...' -ForegroundColor Cyan
  Write-Host '1/2 Starting private MinIO transfer tunnel...' -ForegroundColor Yellow
  $minioTunnel = Start-QuickTunnel -Name 'plchat-minio' -Origin "http://127.0.0.1:$minioPort" -Cloudflared $cloudflared -Protocol 'quic'

  Write-Host '2/2 Starting PL CHAT application tunnel...' -ForegroundColor Yellow
  $appTunnel = Start-QuickTunnel -Name 'plchat-app' -Origin "http://127.0.0.1:$appPort" -Cloudflared $cloudflared

  Set-EnvValues -Values @{
    APP_PUBLIC_URL = $appTunnel.Url
    PL_CHAT_ALLOWED_ORIGINS = $appTunnel.Url
    S3_PUBLIC_BASE_URL = $minioTunnel.Url
  }
  Configure-MinioTransferCors -AppUrl $appTunnel.Url
  Restart-PlChat -ExpectedAppUrl $appTunnel.Url -ExpectedMinioUrl $minioTunnel.Url
  Set-Content -LiteralPath $statusPath -Value $appTunnel.Url -Encoding UTF8
  [pscustomobject]@{
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    appUrl = $appTunnel.Url
    minioTransferUrl = $minioTunnel.Url
    appPid = $appTunnel.Process.Id
    minioPid = $minioTunnel.Process.Id
  } | ConvertTo-Json | Set-Content -LiteralPath $jsonStatusPath -Encoding UTF8

  if (!(Wait-HttpReady -Url "http://localhost:$appPort/api/health" -Seconds 10)) {
    throw 'PL CHAT LAN server stopped responding after Quick Tunnel URLs were saved.'
  }
  Write-Host "PL CHAT LAN server kept running on http://192.168.1.117:$appPort. Quick Tunnel URLs were saved without restarting LAN clients." -ForegroundColor Green
  Write-Host "The new Quick Tunnel values are stored in .env.production and tunnel status files. They will be picked up by PL CHAT on the next intentional server restart." -ForegroundColor Yellow

  Write-Host ''
  Write-Host 'PL CHAT Quick Tunnel is ready.' -ForegroundColor Green
  Write-Host "PL CHAT: $($appTunnel.Url)" -ForegroundColor Cyan
  Write-Host "MinIO signed transfer: $($minioTunnel.Url)" -ForegroundColor DarkCyan
  Write-Host ''
  Write-Host 'Keep this window open. Closing it stops both temporary URLs.' -ForegroundColor Yellow
  Write-Host 'Downloads prefer the MinIO signed-transfer tunnel, with PL CHAT stream fallback if direct transfer fails.' -ForegroundColor Green
  Write-Host ''

  $nextAppHealthCheck = Get-Date
  $nextAppListenerCheck = Get-Date
  $lastAppRecoveryAt = [datetime]::MinValue
  $appHealthWarningActive = $false
  while (!$appTunnel.Process.HasExited -and !$minioTunnel.Process.HasExited) {
    if ((Get-Date) -ge $nextAppListenerCheck) {
      $nextAppListenerCheck = (Get-Date).AddSeconds(15)
      $listenerPids = Get-ListeningPidsForPort -Port $appPort
      if (!$listenerPids.Count -and ((Get-Date) - $lastAppRecoveryAt).TotalSeconds -ge 30) {
        $lastAppRecoveryAt = Get-Date
        Write-Host "PL CHAT listener on port $appPort disappeared. Starting the production server again..." -ForegroundColor Yellow
        try {
          Restart-PlChat -ExpectedAppUrl $appTunnel.Url -ExpectedMinioUrl $minioTunnel.Url
          Write-Host 'PL CHAT automatic recovery completed.' -ForegroundColor Green
        } catch {
          Write-Host "PL CHAT automatic recovery failed: $($_.Exception.Message)" -ForegroundColor Red
        }
      }
    }
    if ((Get-Date) -ge $nextAppHealthCheck) {
      $nextAppHealthCheck = (Get-Date).AddSeconds(30)
      if (!(Wait-HttpReady -Url "http://localhost:$appPort/api/health" -Seconds 8)) {
        if (!$appHealthWarningActive) {
          Write-Host 'PL CHAT health check is slow or unavailable. Keeping the current server running to protect active uploads.' -ForegroundColor Yellow
          $appHealthWarningActive = $true
        }
      } elseif ($appHealthWarningActive) {
        Write-Host 'PL CHAT health check recovered.' -ForegroundColor Green
        $appHealthWarningActive = $false
      }
    }
    Start-Sleep -Seconds 2
  }
  throw 'One of the Quick Tunnel processes stopped unexpectedly.'
} finally {
  if ($appTunnel -and $appTunnel.Process -and !$appTunnel.Process.HasExited) {
    Stop-Process -Id $appTunnel.Process.Id -Force -ErrorAction SilentlyContinue
  }
  if ($minioTunnel -and $minioTunnel.Process -and !$minioTunnel.Process.HasExited) {
    Stop-Process -Id $minioTunnel.Process.Id -Force -ErrorAction SilentlyContinue
  }
  foreach ($tunnel in @($appTunnel, $minioTunnel)) {
    if (!$tunnel) { continue }
    if ($tunnel.StdoutEvent) { Unregister-Event -SubscriptionId $tunnel.StdoutEvent.Id -ErrorAction SilentlyContinue }
    if ($tunnel.StderrEvent) { Unregister-Event -SubscriptionId $tunnel.StderrEvent.Id -ErrorAction SilentlyContinue }
    if ($tunnel.StdoutWriter) { $tunnel.StdoutWriter.Dispose() }
    if ($tunnel.StderrWriter) { $tunnel.StderrWriter.Dispose() }
  }
  Remove-Item -LiteralPath (Join-Path $statusDir 'plchat-app.pid'), (Join-Path $statusDir 'plchat-minio.pid') -Force -ErrorAction SilentlyContinue
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  if ($mutex -and $mutexAcquired) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  if ($mutex) {
    $mutex.Dispose()
  }
}

