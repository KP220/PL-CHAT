$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env.production"
$templatePath = Join-Path $root ".env.production.example"
$composePath = Join-Path $root "docker-compose.storage.yml"

function Parse-EnvFile {
  param([string[]] $Lines)
  $map = [ordered]@{}
  foreach ($line in $Lines) {
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

Write-Host ""
Write-Host "PL CHAT MinIO storage setup" -ForegroundColor Cyan
Write-Host "The bucket stays private. PL CHAT grants temporary signed access after permission checks." -ForegroundColor Yellow
Write-Host ""

$sourcePath = if (Test-Path -LiteralPath $envPath) { $envPath } else { $templatePath }
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Missing environment template: $templatePath"
}
if (-not (Test-Path -LiteralPath $composePath)) {
  throw "Missing MinIO compose file: $composePath"
}

function Test-DockerReady {
  try {
    docker version --format "{{.Server.Version}}" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

if (-not (Test-DockerReady)) {
  $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop is not installed."
  }
  Write-Host "Starting Docker Desktop. Approve the Windows prompt if it appears..." -ForegroundColor Cyan
  Start-Process -FilePath $dockerDesktop
  $dockerReady = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Seconds 2
    if (Test-DockerReady) {
      $dockerReady = $true
      break
    }
  }
  if (-not $dockerReady) {
    throw "Docker Desktop did not become ready. Open Docker Desktop, finish its first-run setup, then run this script again."
  }
}

$values = Parse-EnvFile -Lines (Get-Content -LiteralPath $sourcePath)
if (-not $values["S3_ACCESS_KEY_ID"]) {
  $values["S3_ACCESS_KEY_ID"] = "plchat_admin"
}
if (-not $values["S3_SECRET_ACCESS_KEY"]) {
  $values["S3_SECRET_ACCESS_KEY"] = New-RandomSecret
}
if (-not $values["S3_BUCKET"]) {
  $values["S3_BUCKET"] = "plchat-files"
}

$values["S3_ENDPOINT"] = "http://localhost:9000"
$values["S3_REGION"] = "us-east-1"
$values["S3_FORCE_PATH_STYLE"] = "true"
$values["S3_SESSION_TOKEN"] = ""
$values["S3_PUBLIC_BASE_URL"] = ""

$stagingPath = Join-Path $root ".env.storage.pending"
Save-EnvFile -Values $values -Path $stagingPath

Push-Location $root
try {
  docker compose --env-file $stagingPath -f $composePath up -d
  if ($LASTEXITCODE -ne 0) { throw "MinIO failed to start." }

  $initComplete = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 2
    $initState = docker inspect -f "{{.State.Status}}:{{.State.ExitCode}}" plchat-minio-init 2>$null
    if ($initState -eq "exited:0") {
      $initComplete = $true
      break
    }
    if ($initState -match '^exited:(?!0)') {
      docker logs plchat-minio-init
      throw "MinIO bucket initialization failed."
    }
  }
  if (-not $initComplete) {
    throw "MinIO bucket initialization timed out."
  }

  $healthy = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 2
    try {
      $response = Invoke-WebRequest -Uri "http://localhost:9000/minio/health/ready" -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    } catch {
      # MinIO may still be starting.
    }
  }
  if (-not $healthy) {
    throw "MinIO did not become healthy. PL CHAT storage was not switched."
  }

  $env:S3_ENDPOINT = $values["S3_ENDPOINT"]
  $env:S3_BUCKET = $values["S3_BUCKET"]
  $env:S3_REGION = $values["S3_REGION"]
  $env:S3_ACCESS_KEY_ID = $values["S3_ACCESS_KEY_ID"]
  $env:S3_SECRET_ACCESS_KEY = $values["S3_SECRET_ACCESS_KEY"]
  $env:S3_FORCE_PATH_STYLE = $values["S3_FORCE_PATH_STYLE"]

  @'
import { createS3MultipartStorage } from "./trial-server/s3-multipart-storage.mjs";
const storage = createS3MultipartStorage(process.env);
if (!storage.ready) throw new Error("minio_not_configured");
const key = `pl-chat-config-check/${Date.now()}-probe.txt`;
const created = await storage.createMultipartUpload({ key });
await storage.abortMultipartUpload({ key, uploadId: created.uploadId });
console.log("MINIO_MULTIPART_OK");
'@ | node --input-type=module -
  if ($LASTEXITCODE -ne 0) {
    throw "MinIO multipart verification failed. PL CHAT storage was not switched."
  }

  $backupPath = "$envPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  if (Test-Path -LiteralPath $envPath) {
    Copy-Item -LiteralPath $envPath -Destination $backupPath
  }
  $values["FILE_STORAGE_DRIVER"] = "s3"
  $values["ENABLE_DIRECT_UPLOAD"] = "true"
  $values["ENABLE_MULTIPART_UPLOAD"] = "true"
  Save-EnvFile -Values $values -Path $envPath
} finally {
  Pop-Location
  Remove-Item -LiteralPath $stagingPath -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "MinIO storage is running and PL CHAT S3 multipart is enabled." -ForegroundColor Green
Write-Host "MinIO console: http://localhost:9001" -ForegroundColor Cyan
Write-Host "Restart PL CHAT to load the new storage configuration." -ForegroundColor Yellow
