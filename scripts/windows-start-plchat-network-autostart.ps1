$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$logDir = Join-Path $root 'pl-chat-data\autostart'
$logPath = Join-Path $logDir 'plchat-network-autostart.log'
$statusPath = Join-Path $logDir 'plchat-network-autostart-status.json'
$appPort = 8788
$minioPort = 9000
$kaveepPort = 8765
$mutex = New-Object System.Threading.Mutex($false, 'PLChatNetworkAutostart')
$mutexAcquired = $false
try {
  $mutexAcquired = $mutex.WaitOne(0, $false)
} catch {
  $mutex.Dispose()
  throw 'Could not acquire the PL CHAT Network Autostart lock.'
}
if (!$mutexAcquired) {
  Write-Host 'PL CHAT Network Autostart is already running. This window can be closed.' -ForegroundColor Yellow
  $mutex.Dispose()
  exit 0
}

function Write-Step {
  param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) -ForegroundColor $Color
}

function Read-EnvValue {
  param([string]$Name, [string]$Default = '')
  $envPath = Join-Path $root '.env.production'
  if (!(Test-Path -LiteralPath $envPath)) { return $Default }
  $match = Select-String -LiteralPath $envPath -Pattern "^$([regex]::Escape($Name))=" | Select-Object -First 1
  if (!$match) { return $Default }
  return ($match.Line -split '=', 2)[1].Trim().Trim('"')
}

function Wait-HttpOk {
  param([string]$Url, [int]$Seconds = 60)
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Get-AppHealth {
  param([int]$Port)
  try {
    return Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 4
  } catch {
    return $null
  }
}

function Get-KaveepHealth {
  param([int]$Port)
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
  } catch {
    return $null
  }
}

function Test-ReleaseManagerRoute {
  param([int]$Port)
  $routeUrl = "http://127.0.0.1:$Port/api/admin/desktop-update/publish?version=1.0.2&fileName=test.exe"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $routeUrl -Method Post -Body "" -TimeoutSec 5 -ErrorAction Stop | Out-Null
    return $true
  } catch {
    $statusCode = 0
    $body = ""
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
      } catch {}
    }
    return ($statusCode -eq 401 -or $body -match "unauthorized|Login required")
  }
}

function Stop-AppPortNode {
  param([int]$Port)
  $listeners = netstat -ano | Select-String ":$Port\s+.*LISTENING"
  foreach ($line in $listeners) {
    $parts = ($line.ToString().Trim() -split "\s+")
    $pidValue = [int]$parts[-1]
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq "node") {
      Write-Step "Stopping old PL CHAT node PID $pidValue" Yellow
      Stop-Process -Id $pidValue -Force
    }
  }
  Start-Sleep -Seconds 2
}

function Start-KaveepLocalQwenChecked {
  param([int]$Port)
  $health = Get-KaveepHealth -Port $Port
  if ($health -and $health.service -eq 'kaveep-local-qwen') {
    Write-Step 'KAVEEP Local Qwen integration is ready.' Green
    return
  }
  if ($health) {
    Write-Step 'Replacing old KAVEEP service with Local Qwen integration...' Yellow
    Stop-AppPortNode -Port $Port
  }
  $starter = Join-Path $PSScriptRoot 'windows-start-kaveep-local-qwen.cmd'
  if (!(Test-Path -LiteralPath $starter)) { throw "KAVEEP starter is missing: $starter" }
  Write-Step 'Starting KAVEEP Local Qwen integration...' Yellow
  Start-CmdHidden -CmdPath $starter -WorkingDirectory (Split-Path -Parent $starter)
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $current = Get-KaveepHealth -Port $Port
    if ($current -and $current.service -eq 'kaveep-local-qwen') {
      Write-Step 'KAVEEP Local Qwen integration is ready.' Green
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "KAVEEP Local Qwen integration did not become ready on port $Port."
}

function Start-CmdHidden {
  param([string]$CmdPath, [string]$WorkingDirectory)
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$CmdPath`"") -WorkingDirectory $WorkingDirectory -WindowStyle Hidden | Out-Null
}

function Resolve-MinioStarter {
  $knownStarters = @(
    'C:\Users\PC\Documents\Codex\2026-06-20\no-blkio-throttle-error-1-2\outputs\PLCHAT-MinIO\start-minio.cmd',
    (Join-Path $PSScriptRoot 'windows-start-minio-portable.cmd')
  )
  foreach ($candidate in $knownStarters) {
    if (Test-Path -LiteralPath $candidate) {
      return [pscustomobject]@{
        CmdPath = $candidate
        WorkingDirectory = Split-Path -Parent $candidate
      }
    }
  }
  throw 'No MinIO starter was found. Expected PLCHAT-MinIO\start-minio.cmd or scripts\windows-start-minio-portable.cmd.'
}

function Start-PLChatProductionChecked {
  param([int]$Port)
  Write-Step 'Checking PL CHAT Production...'
  $health = Get-AppHealth -Port $Port
  $releaseManagerReady = $false
  if ($health -and $health.ok) {
    $releaseManagerReady = Test-ReleaseManagerRoute -Port $Port
  }

  if ($health -and $health.ok -and $releaseManagerReady) {
    Write-Step 'PL CHAT local server is ready with Release Manager.' Green
    return
  }

  if ($health -and $health.ok -and !$releaseManagerReady) {
    Write-Step 'PL CHAT is running, but Release Manager route is missing. Restarting old server...' Yellow
    Stop-AppPortNode -Port $Port
  }

  Write-Step 'Starting PL CHAT Production...' Yellow
  Start-CmdHidden -CmdPath (Join-Path $PSScriptRoot 'windows-start-pl-chat-production.cmd') -WorkingDirectory $root

  $deadline = (Get-Date).AddSeconds(90)
  do {
    $currentHealth = Get-AppHealth -Port $Port
    if ($currentHealth -and $currentHealth.ok -and (Test-ReleaseManagerRoute -Port $Port)) {
      Write-Step 'PL CHAT local server is ready with Release Manager.' Green
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "PL CHAT did not become ready with Release Manager on port $Port."
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Transcript -LiteralPath $logPath -Append | Out-Null

try {
  Set-Location $root
  $configuredPort = Read-EnvValue -Name 'PL_CHAT_PORT' -Default '8788'
  if ($configuredPort -match '^\d+$') { $appPort = [int]$configuredPort }
  $env:PL_CHAT_SERVICE_TOKEN = Read-EnvValue -Name 'KAVEEP_SERVICE_TOKEN'
  if (!$env:PL_CHAT_SERVICE_TOKEN -or $env:PL_CHAT_SERVICE_TOKEN -eq 'replace-with-the-same-service-token-configured-in-kaveep') {
    throw 'KAVEEP_SERVICE_TOKEN must be configured in .env.production before Network Autostart can run.'
  }

  Write-Host ''
  Write-Host '============================================================' -ForegroundColor DarkCyan
  Write-Host ' PL CHAT Network Autostart' -ForegroundColor Cyan
  Write-Host ' Starts MinIO, PL CHAT Production, and Dual Quick Tunnel.' -ForegroundColor Cyan
  Write-Host ' Keep this window open while PL CHAT public links are needed.' -ForegroundColor Yellow
  Write-Host '============================================================' -ForegroundColor DarkCyan
  Write-Host ''

  Write-Step 'Checking MinIO...'
  if (!(Wait-HttpOk -Url "http://localhost:$minioPort/minio/health/live" -Seconds 5)) {
    Write-Step 'Starting MinIO...' Yellow
    $minioStarter = Resolve-MinioStarter
    Write-Step "Using MinIO starter: $($minioStarter.CmdPath)" DarkCyan
    Start-CmdHidden -CmdPath $minioStarter.CmdPath -WorkingDirectory $minioStarter.WorkingDirectory
    if (!(Wait-HttpOk -Url "http://localhost:$minioPort/minio/health/live" -Seconds 75)) {
      throw "MinIO did not become ready on port $minioPort."
    }
  }
  Write-Step 'MinIO is ready.' Green

  & (Join-Path $PSScriptRoot 'windows-start-local-ai-backends.ps1')
  Start-KaveepLocalQwenChecked -Port $kaveepPort

  Start-PLChatProductionChecked -Port $appPort

  Write-Step 'Starting latest Dual Quick Tunnel launcher...' Yellow
  Write-Step 'A new PL CHAT URL and MinIO signed-transfer URL will be generated on every boot.' DarkCyan

  & (Join-Path $PSScriptRoot 'windows-start-public-tunnel.ps1')

} catch {
  $errorMessage = $_.Exception.Message
  Write-Host ''
  Write-Host "PL CHAT Network Autostart failed: $errorMessage" -ForegroundColor Red
  [pscustomobject]@{
    ok = $false
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    error = $errorMessage
    logPath = $logPath
  } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
  Write-Host "Log: $logPath" -ForegroundColor Yellow
  Write-Host 'Press any key to close this window...' -ForegroundColor Yellow
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
} finally {
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  if ($mutex -and $mutexAcquired) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  if ($mutex) {
    $mutex.Dispose()
  }
}


