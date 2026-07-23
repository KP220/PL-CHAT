param(
  [string] $MinioDir = "C:\minio",
  [string] $DataDir = "C:\minio\data",
  [string] $ConsoleAddress = ":9001"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env.production"
$minioExe = Join-Path $MinioDir "minio.exe"
$logDir = Join-Path $MinioDir "logs"
$logPath = Join-Path $logDir "minio.log"

function Parse-EnvFile {
  param([string] $Path)
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $name, $value = $trimmed.Split("=", 2)
    $map[$name.Trim()] = $value.Trim().Trim('"')
  }
  return $map
}

function New-RandomSecret {
  $bytes = New-Object byte[] 36
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").TrimEnd("=")
}

function Test-MinioReady {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:9000/minio/health/ready" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

Write-Host ""
Write-Host "PL CHAT MinIO portable starter" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $minioExe)) {
  Write-Host "MinIO server was not found: $minioExe" -ForegroundColor Red
  Write-Host "Please place the MinIO server file named minio.exe in C:\minio first." -ForegroundColor Yellow
  Write-Host "The existing mc.exe file is only the MinIO client and cannot run the server." -ForegroundColor Yellow
  Write-Host "Download server: https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -ForegroundColor Cyan
  exit 2
}

if (Test-MinioReady) {
  Write-Host "MinIO is already running at http://localhost:9000" -ForegroundColor Green
  Write-Host "Console: http://localhost:9001" -ForegroundColor Cyan
  exit 0
}

$values = Parse-EnvFile -Path $envPath
$rootUser = if ($values["S3_ACCESS_KEY_ID"]) { $values["S3_ACCESS_KEY_ID"] } else { "plchat_admin" }
$rootPassword = if ($values["S3_SECRET_ACCESS_KEY"]) { $values["S3_SECRET_ACCESS_KEY"] } else { New-RandomSecret }

New-Item -ItemType Directory -Force -Path $MinioDir, $DataDir, $logDir | Out-Null

$runnerPath = Join-Path $MinioDir "plchat-start-minio.ps1"
$runner = @(
  '$ErrorActionPreference = "Stop"',
  ('$env:MINIO_ROOT_USER = "{0}"' -f ($rootUser -replace '"', '\"')),
  ('$env:MINIO_ROOT_PASSWORD = "{0}"' -f ($rootPassword -replace '"', '\"')),
  ('& "{0}" server "{1}" --console-address "{2}" *>> "{3}"' -f $minioExe, $DataDir, $ConsoleAddress, $logPath)
) -join [Environment]::NewLine
Set-Content -LiteralPath $runnerPath -Value $runner -Encoding UTF8

Write-Host "Starting MinIO as a normal Windows background process..." -ForegroundColor Cyan
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runnerPath) -WindowStyle Hidden

$ready = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
  Start-Sleep -Seconds 1
  if (Test-MinioReady) {
    $ready = $true
    break
  }
}

if (-not $ready) {
  Write-Host "MinIO did not become ready yet. Check log: $logPath" -ForegroundColor Red
  exit 1
}

Write-Host "MinIO is running." -ForegroundColor Green
Write-Host "API: http://localhost:9000" -ForegroundColor Cyan
Write-Host "Console: http://localhost:9001" -ForegroundColor Cyan
Write-Host "User: $rootUser" -ForegroundColor Cyan
Write-Host "Password is stored only on this computer for PL CHAT startup." -ForegroundColor Yellow
