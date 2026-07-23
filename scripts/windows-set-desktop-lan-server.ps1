param(
  [Parameter(Mandatory = $true)]
  [string]$AppUrl,
  [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'

try {
  $uri = [uri]$AppUrl
  if ($uri.Scheme -notin @('http', 'https') -or !$uri.Host) {
    throw 'Invalid server URL.'
  }
} catch {
  throw 'Use a full server URL such as http://192.168.1.50:8788'
}

$configPath = $ConfigPath
if (!$configPath) {
  $configDir = Join-Path $env:APPDATA 'PL CHAT'
  $configPath = Join-Path $configDir 'desktop-server.json'
} else {
  $configDir = Split-Path -Parent $configPath
}
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

@{
  appUrl = $AppUrl.TrimEnd('/')
  mode = 'lan-only-v1'
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host "PL CHAT desktop server URL saved:" -ForegroundColor Green
Write-Host $AppUrl.TrimEnd('/') -ForegroundColor Cyan
Write-Host "Config: $configPath" -ForegroundColor DarkCyan
Write-Host 'Close and reopen PL CHAT, or use Try Again on the offline page.' -ForegroundColor Yellow
