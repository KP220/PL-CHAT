$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Assert-SafeIdentifier {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ($Value -notmatch '^[A-Za-z0-9_]+$') {
    throw "$Name may contain only letters, numbers, and underscores."
  }
}

$ContainerName = $env:PHASEB_POSTGRES_CONTAINER
if ([string]::IsNullOrWhiteSpace($ContainerName)) {
  $ContainerName = "please-postgres"
}

$DbName = $env:PHASEB_DATABASE_NAME
if ([string]::IsNullOrWhiteSpace($DbName)) {
  $DbName = "plchat_phaseb"
}

$DbUser = $env:PHASEB_DATABASE_USER
if ([string]::IsNullOrWhiteSpace($DbUser)) {
  $DbUser = "plchat_phaseb_user"
}

$DbPassword = $env:PHASEB_DATABASE_PASSWORD
if ([string]::IsNullOrWhiteSpace($DbPassword)) {
  $DbPassword = "plchat_phaseb_password"
}

Assert-SafeIdentifier -Name "PHASEB_DATABASE_NAME" -Value $DbName
Assert-SafeIdentifier -Name "PHASEB_DATABASE_USER" -Value $DbUser

$DatabaseUrl = $env:PHASEB_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  $EncodedPassword = [System.Uri]::EscapeDataString($DbPassword)
  $DatabaseUrl = "postgresql://$DbUser`:$EncodedPassword@localhost:5432/$DbName"
}

Write-Host "PL CHAT Phase B test database"
Write-Host "Container: $ContainerName"
Write-Host "Database:  $DbName"
Write-Host "DB user:   $DbUser"
Write-Host ""

$running = & docker ps --filter "name=$ContainerName" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to access Docker. Start Docker Desktop and run this PowerShell as a user allowed to use Docker."
}
if ($running -ne $ContainerName) {
  throw "PostgreSQL container '$ContainerName' is not running. Start Docker/PostgreSQL first."
}

$EscapedPassword = $DbPassword.Replace("'", "''")
$RoleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE "$DbUser" LOGIN PASSWORD '$EscapedPassword';
  ELSE
    ALTER ROLE "$DbUser" WITH LOGIN PASSWORD '$EscapedPassword';
  END IF;
END
`$`$;
"@

Write-Host "Preparing Phase B database user..."
Invoke-Native -Name "Create/update Phase B database user" -Command {
  docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c $RoleSql
}

$exists = & docker exec $ContainerName psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName';"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect PostgreSQL databases."
}
if ($exists -ne "1") {
  Write-Host "Creating database $DbName..."
  Invoke-Native -Name "Create Phase B database" -Command {
    docker exec $ContainerName createdb -U postgres -O $DbUser $DbName
  }
} else {
  Write-Host "Database $DbName already exists."
}

Write-Host "Granting database permissions..."
Invoke-Native -Name "Grant Phase B database permissions" -Command {
  docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE ""$DbName"" OWNER TO ""$DbUser""; GRANT ALL PRIVILEGES ON DATABASE ""$DbName"" TO ""$DbUser"";"
}
Invoke-Native -Name "Grant Phase B schema permissions" -Command {
  docker exec $ContainerName psql -U postgres -d $DbName -v ON_ERROR_STOP=1 -c "ALTER SCHEMA public OWNER TO ""$DbUser""; GRANT ALL ON SCHEMA public TO ""$DbUser"";"
}

Write-Host "Deploying Prisma migration..."
$env:DATABASE_URL = $DatabaseUrl
Invoke-Native -Name "Prisma migrate deploy" -Command {
  apps\api\node_modules\.bin\prisma.cmd migrate deploy --schema apps/api/prisma/schema.prisma
}

Write-Host "Importing PL CHAT JSON data into test database..."
Invoke-Native -Name "PL CHAT JSON import apply" -Command {
  npm.cmd run plchat:import:apply
}

Write-Host "Verifying imported data..."
Invoke-Native -Name "PL CHAT JSON import verify" -Command {
  npm.cmd --prefix apps/api run data:import:verify
}

Write-Host ""
Write-Host "Phase B test database migration/import completed."
