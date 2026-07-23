$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env.production"
$templatePath = Join-Path $root ".env.production.example"

function Read-Default {
  param(
    [string] $Label,
    [string] $DefaultValue,
    [string] $EnvName = ""
  )
  if ($DefaultValue) {
    $value = Read-Host "$Label [$DefaultValue]"
    if ([string]::IsNullOrWhiteSpace($value)) { return Clean-InputValue $DefaultValue $EnvName }
    return Clean-InputValue $value $EnvName
  }
  return Clean-InputValue (Read-Host $Label) $EnvName
}

function Clean-InputValue {
  param(
    [string] $Value,
    [string] $EnvName = ""
  )
  $clean = String-TrimQuotes $Value
  if ($EnvName -and $clean -match ("^\s*" + [regex]::Escape($EnvName) + "\s*[:=]\s*(.+)$")) {
    $clean = String-TrimQuotes $Matches[1]
  }
  return $clean
}

function String-TrimQuotes {
  param([string] $Value)
  $clean = String($Value).Trim()
  if (($clean.StartsWith('"') -and $clean.EndsWith('"')) -or ($clean.StartsWith("'") -and $clean.EndsWith("'"))) {
    $clean = $clean.Substring(1, $clean.Length - 2).Trim()
  }
  return $clean
}

function String {
  param($Value)
  return [string]$Value
}

function Clean-Default {
  param(
    [string] $Value,
    [string] $EnvName,
    [string] $Fallback = ""
  )
  $clean = Clean-InputValue $Value $EnvName
  if (-not $clean -or $clean -match "\b[A-Z][A-Z0-9_]+\s*[:=]" -or $clean -match "windows-configure-smtp") {
    return $Fallback
  }
  return $clean
}

function SecureString-ToPlainText {
  param([securestring] $Value)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

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

Write-Host ""
Write-Host "PL CHAT SMTP configuration" -ForegroundColor Cyan
Write-Host "Use an SMTP app password or SMTP API password. Do not use your normal email password." -ForegroundColor Yellow
Write-Host ""

$sourcePath = if (Test-Path -LiteralPath $envPath) { $envPath } else { $templatePath }
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Missing environment template: $templatePath"
}

$values = Parse-EnvFile -Lines (Get-Content -LiteralPath $sourcePath)

$currentPublicUrl = Clean-Default ($values["APP_PUBLIC_URL"] -replace "https://your-real-domain.com", "http://localhost:8788") "APP_PUBLIC_URL" "http://localhost:8788"
$appPublicUrl = Read-Default "APP_PUBLIC_URL for email links" $currentPublicUrl "APP_PUBLIC_URL"
$smtpHost = Read-Default "SMTP_HOST" (Clean-Default $values["SMTP_HOST"] "SMTP_HOST" "smtp.gmail.com") "SMTP_HOST"
$smtpPort = Read-Default "SMTP_PORT" (Clean-Default $values["SMTP_PORT"] "SMTP_PORT" "465") "SMTP_PORT"
$smtpSecure = Read-Default "SMTP_SECURE true for port 465, false for 587" (Clean-Default $values["SMTP_SECURE"] "SMTP_SECURE" "true") "SMTP_SECURE"
$smtpRequireTls = Read-Default "SMTP_REQUIRE_TLS" (Clean-Default $values["SMTP_REQUIRE_TLS"] "SMTP_REQUIRE_TLS" "true") "SMTP_REQUIRE_TLS"
$smtpUser = Read-Default "SMTP_USER email/login" (Clean-Default $values["SMTP_USER"] "SMTP_USER" "") "SMTP_USER"
$fromDefault = if ($values["SMTP_FROM"] -and $values["SMTP_FROM"] -notmatch "your-domain|^$") { $values["SMTP_FROM"] } elseif ($smtpUser) { "PL CHAT <$smtpUser>" } else { "" }
$fromDefault = Clean-Default $fromDefault "SMTP_FROM" ($(if ($smtpUser) { "PL CHAT <$smtpUser>" } else { "" }))
$smtpFrom = Read-Default "SMTP_FROM sender" $fromDefault "SMTP_FROM"

$securePassword = Read-Host "SMTP_PASSWORD / app password (hidden; press Enter to keep existing)" -AsSecureString
$smtpPassword = SecureString-ToPlainText $securePassword
if ([string]::IsNullOrWhiteSpace($smtpPassword)) {
  $smtpPassword = Clean-Default $values["SMTP_PASSWORD"] "SMTP_PASSWORD" ""
}
if ([string]::IsNullOrWhiteSpace($smtpPassword)) {
  throw "SMTP_PASSWORD is required."
}

$values["NODE_ENV"] = "production"
$values["APP_NAME"] = "PL CHAT"
$values["APP_ENV"] = "production"
$values["APP_PUBLIC_URL"] = $appPublicUrl
$values["PL_CHAT_PORT"] = if ($values["PL_CHAT_PORT"]) { $values["PL_CHAT_PORT"] } else { "8788" }
$values["SMTP_HOST"] = $smtpHost
$values["SMTP_PORT"] = $smtpPort
$values["SMTP_SECURE"] = $smtpSecure
$values["SMTP_REQUIRE_TLS"] = $smtpRequireTls
$values["SMTP_USER"] = $smtpUser
$values["SMTP_PASSWORD"] = $smtpPassword
$values["SMTP_FROM"] = $smtpFrom
$values["EMAIL_VERIFICATION_REQUIRED"] = "true"

$orderedKeys = @(
  "NODE_ENV",
  "APP_NAME",
  "APP_ENV",
  "APP_PUBLIC_URL",
  "DATABASE_URL",
  "SESSION_SECRET",
  "JWT_SECRET",
  "AUTH_SECRET",
  "PL_CHAT_PORT",
  "PL_CHAT_HOST",
  "PL_CHAT_DATA_DIR",
  "PL_CHAT_MAX_JSON_MB",
  "PL_CHAT_MAX_UPLOAD_MB",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "INVITE_TOKEN_EXPIRES_HOURS",
  "EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS",
  "PASSWORD_RESET_TOKEN_EXPIRES_MINUTES",
  "EMAIL_VERIFICATION_REQUIRED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ASSISTANT_PORT"
)

$lines = New-Object System.Collections.Generic.List[string]
foreach ($key in $orderedKeys) {
  if ($values.Contains($key)) {
    $lines.Add("$key=$(Quote-EnvValue $values[$key])")
  }
}
foreach ($key in $values.Keys) {
  if ($orderedKeys -notcontains $key) {
    $lines.Add("$key=$(Quote-EnvValue $values[$key])")
  }
}

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8

Write-Host ""
Write-Host "Saved SMTP settings to .env.production" -ForegroundColor Green
Write-Host "Restart PL CHAT with:" -ForegroundColor Cyan
Write-Host ".\scripts\windows-start-pl-chat-production.cmd"
Write-Host ""
Write-Host "After restart, register a new account or use the admin button: Test SMTP to my email." -ForegroundColor Cyan
