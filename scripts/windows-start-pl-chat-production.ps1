$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}

$env:APP_ENV = if ($env:APP_ENV) { $env:APP_ENV } else { "production" }
$env:NODE_ENV = if ($env:NODE_ENV) { $env:NODE_ENV } else { "production" }
$env:APP_NAME = if ($env:APP_NAME) { $env:APP_NAME } else { "PL CHAT" }
$env:PL_CHAT_PORT = if ($env:PL_CHAT_PORT) { $env:PL_CHAT_PORT } else { "8788" }

$envFile = Join-Path $root ".env.production"
if (Test-Path -LiteralPath $envFile) {
  Get-Content -LiteralPath $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }
    $name, $value = $line.Split("=", 2)
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"'), "Process")
  }
}

Write-Host ""
Write-Host "Starting PL CHAT Internal Workspace..." -ForegroundColor Cyan
Write-Host "Environment: $env:APP_ENV" -ForegroundColor Yellow
Write-Host "Keep this PowerShell window open while PL CHAT is running." -ForegroundColor Yellow
Write-Host ""

$healthUrl = "http://localhost:$($env:PL_CHAT_PORT)/api/health"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
  if ($health.ok -and $health.service -eq "pl-chat-internal-workspace") {
    Write-Host "PL CHAT is already running. A second server was not started." -ForegroundColor Green
    Write-Host "Open: http://localhost:$($env:PL_CHAT_PORT)" -ForegroundColor Cyan
    exit 0
  }
} catch {
  # No healthy PL CHAT server is responding yet. Continue with normal startup.
}

$portInUse = $false
$tcpClient = New-Object System.Net.Sockets.TcpClient
try {
  $connect = $tcpClient.BeginConnect("127.0.0.1", [int]$env:PL_CHAT_PORT, $null, $null)
  $portInUse = $connect.AsyncWaitHandle.WaitOne(700) -and $tcpClient.Connected
} finally {
  $tcpClient.Close()
}

if ($portInUse) {
  Write-Host "Port $($env:PL_CHAT_PORT) is already used by another application." -ForegroundColor Red
  Write-Host "PL CHAT was not started to prevent a duplicate-server error." -ForegroundColor Yellow
  exit 1
}

node ".\trial-server\server.mjs"
