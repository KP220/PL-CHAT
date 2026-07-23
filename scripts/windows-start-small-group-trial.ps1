$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}

$env:PL_CHAT_TRIAL_PORT = if ($env:PL_CHAT_TRIAL_PORT) { $env:PL_CHAT_TRIAL_PORT } else { "8788" }

$envFile = Join-Path $root "trial-server\.env.trial"
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
Write-Host "Keep this PowerShell window open while people are testing." -ForegroundColor Yellow
Write-Host "Fallback verification/reset/invite links will appear here if SMTP is not configured." -ForegroundColor Yellow
Write-Host ""

node ".\trial-server\server.mjs"
