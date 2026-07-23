param(
  [string] $MinioDir = "C:\minio",
  [string] $DataDir = "C:\minio\data",
  [string] $Bucket = "plchat-files",
  [switch] $SkipStartupTask
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env.production"
$templatePath = Join-Path $root ".env.production.example"
$minioExe = Join-Path $MinioDir "minio.exe"
$mcCandidates = @(
  (Join-Path $MinioDir "mc.exe"),
  (Join-Path $MinioDir "mc.exe.exe")
)

function Parse-EnvFile {
  param([string] $Path)
  $map = [ordered]@{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $name, $value = $trimmed.Split("=", 2)
    $map[$name.Trim()] = $value.Trim().Trim('"')
  }

  return $map
}

function Quote-EnvValue {
  param([string] $Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

function New-RandomSecret {
  $bytes = New-Object byte[] 36
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").TrimEnd("=")
}

function Save-EnvFile {
  param(
    [System.Collections.IDictionary] $Values,
    [string] $Path
  )

  $priority = @(
    "NODE_ENV",
    "APP_NAME",
    "APP_ENV",
    "APP_PUBLIC_URL",
    "PL_CHAT_DESKTOP_URL",
    "PL_CHAT_PORT",
    "PL_CHAT_HOST",
    "FILE_STORAGE_DRIVER",
    "ENABLE_DIRECT_UPLOAD",
    "ENABLE_MULTIPART_UPLOAD",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_SESSION_TOKEN",
    "S3_FORCE_PATH_STYLE",
    "S3_PUBLIC_BASE_URL"
  )

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($key in $priority) {
    if ($Values.Contains($key)) {
      $lines.Add("$key=$(Quote-EnvValue ([string]$Values[$key]))")
    }
  }

  foreach ($key in $Values.Keys) {
    if ($priority -notcontains $key) {
      $lines.Add("$key=$(Quote-EnvValue ([string]$Values[$key]))")
    }
  }

  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
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
Write-Host "PL CHAT MinIO portable storage setup" -ForegroundColor Cyan
Write-Host "This mode uses Windows minio.exe directly. Docker and WSL are not required." -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path -LiteralPath $minioExe)) {
  Write-Host "Missing MinIO server: $minioExe" -ForegroundColor Red
  Write-Host "The file currently in C:\minio appears to be mc.exe, which is the MinIO client, not the server." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Download the MinIO server and save it as:" -ForegroundColor Cyan
  Write-Host "  C:\minio\minio.exe" -ForegroundColor White
  Write-Host "Official server URL:" -ForegroundColor Cyan
  Write-Host "  https://dl.min.io/server/minio/release/windows-amd64/minio.exe" -ForegroundColor White
  Write-Host ""
  Write-Host "PL CHAT storage was not changed. It remains on the current safe storage mode." -ForegroundColor Yellow
  exit 2
}

$mcExe = $null
foreach ($candidate in $mcCandidates) {
  if (Test-Path -LiteralPath $candidate) {
    $mcExe = $candidate
    break
  }
}

if (-not $mcExe) {
  Write-Host "Missing MinIO client: C:\minio\mc.exe" -ForegroundColor Red
  Write-Host "Download the client from: https://dl.min.io/client/mc/release/windows-amd64/mc.exe" -ForegroundColor Cyan
  Write-Host "PL CHAT storage was not changed." -ForegroundColor Yellow
  exit 2
}

$sourcePath = if (Test-Path -LiteralPath $envPath) { $envPath } else { $templatePath }
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Missing environment template: $templatePath"
}

$values = Parse-EnvFile -Path $sourcePath
if (-not $values["S3_ACCESS_KEY_ID"]) { $values["S3_ACCESS_KEY_ID"] = "plchat_admin" }
if (-not $values["S3_SECRET_ACCESS_KEY"]) { $values["S3_SECRET_ACCESS_KEY"] = New-RandomSecret }

$values["S3_ENDPOINT"] = "http://localhost:9000"
$values["S3_BUCKET"] = $Bucket
$values["S3_REGION"] = "us-east-1"
$values["S3_FORCE_PATH_STYLE"] = "true"
$values["S3_SESSION_TOKEN"] = ""
$values["S3_PUBLIC_BASE_URL"] = ""

& (Join-Path $PSScriptRoot "windows-start-minio-portable.ps1") -MinioDir $MinioDir -DataDir $DataDir
if ($LASTEXITCODE -ne 0) {
  throw "MinIO did not start. PL CHAT storage was not switched."
}

if (-not (Test-MinioReady)) {
  throw "MinIO is not healthy. PL CHAT storage was not switched."
}

Write-Host "Creating private PL CHAT bucket if needed..." -ForegroundColor Cyan
& $mcExe alias set plchat "http://localhost:9000" $values["S3_ACCESS_KEY_ID"] $values["S3_SECRET_ACCESS_KEY"] | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to configure MinIO client alias." }

& $mcExe mb --ignore-existing "plchat/$Bucket" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to create MinIO bucket." }

& $mcExe anonymous set none "plchat/$Bucket" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Failed to keep MinIO bucket private." }

Write-Host "Verifying PL CHAT direct multipart against MinIO..." -ForegroundColor Cyan
$env:S3_ENDPOINT = $values["S3_ENDPOINT"]
$env:S3_BUCKET = $values["S3_BUCKET"]
$env:S3_REGION = $values["S3_REGION"]
$env:S3_ACCESS_KEY_ID = $values["S3_ACCESS_KEY_ID"]
$env:S3_SECRET_ACCESS_KEY = $values["S3_SECRET_ACCESS_KEY"]
$env:S3_FORCE_PATH_STYLE = $values["S3_FORCE_PATH_STYLE"]

Push-Location $root
try {
  @'
import { createS3MultipartStorage } from "./trial-server/s3-multipart-storage.mjs";
const storage = createS3MultipartStorage(process.env);
if (!storage.ready) throw new Error("minio_not_configured");
const key = `pl-chat-portable-check/${Date.now()}-probe.txt`;
const created = await storage.createMultipartUpload({ key });
await storage.abortMultipartUpload({ key, uploadId: created.uploadId });
console.log("MINIO_PORTABLE_MULTIPART_OK");
'@ | node --input-type=module -
  if ($LASTEXITCODE -ne 0) {
    throw "MinIO multipart verification failed. PL CHAT storage was not switched."
  }
} finally {
  Pop-Location
}

$backupPath = "$envPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path -LiteralPath $envPath) {
  Copy-Item -LiteralPath $envPath -Destination $backupPath
}

$values["FILE_STORAGE_DRIVER"] = "s3"
$values["ENABLE_DIRECT_UPLOAD"] = "true"
$values["ENABLE_MULTIPART_UPLOAD"] = "true"
Save-EnvFile -Values $values -Path $envPath

if (-not $SkipStartupTask) {
  & (Join-Path $PSScriptRoot "windows-install-minio-startup.ps1") -MinioDir $MinioDir
}

Write-Host ""
Write-Host "MinIO portable storage is ready for PL CHAT." -ForegroundColor Green
Write-Host "API: http://localhost:9000" -ForegroundColor Cyan
Write-Host "Console: http://localhost:9001" -ForegroundColor Cyan
Write-Host "Bucket: $Bucket" -ForegroundColor Cyan
Write-Host "PL CHAT was switched to S3/MinIO only after verification passed." -ForegroundColor Green
Write-Host "Restart PL CHAT now:" -ForegroundColor Yellow
Write-Host "  .\scripts\windows-start-pl-chat-production.cmd" -ForegroundColor White
