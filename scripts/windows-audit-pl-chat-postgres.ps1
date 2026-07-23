param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$DockerWaitSeconds = 180
)

$ErrorActionPreference = "Stop"

function Test-DockerEngine {
  param([string]$DockerPath)

  $command = '"' + $DockerPath + '" info 1>nul 2>nul'
  & cmd.exe /d /c $command
  return $LASTEXITCODE -eq 0
}

function Invoke-Docker {
  param(
    [string]$DockerPath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$DockerArguments
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& $DockerPath @DockerArguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  $filteredOutput = @($output | Where-Object {
    [string]$_ -notmatch "^WARNING: No blkio throttle"
  })

  if ($exitCode -ne 0) {
    throw "Docker command failed: docker $($DockerArguments -join ' ')`n$($filteredOutput -join [Environment]::NewLine)"
  }

  return $filteredOutput
}

function Invoke-PostgresSql {
  param(
    [string]$DockerPath,
    [string]$Container,
    [string]$User,
    [string]$Database,
    [string]$Sql
  )

  $dockerArguments = @("exec", "-i", $Container, "psql", "-X", "-U", $User, "-d", $Database, "-At")
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @($Sql | & $DockerPath @dockerArguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  $filteredOutput = @($output | Where-Object {
    [string]$_ -notmatch "^WARNING: No blkio throttle"
  })

  if ($exitCode -ne 0) {
    throw "PostgreSQL query failed in container '$Container'.`n$($filteredOutput -join [Environment]::NewLine)"
  }

  return $filteredOutput
}

$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

if (-not (Test-Path -LiteralPath $dockerDesktop)) {
  throw "Docker Desktop was not found at $dockerDesktop"
}
if (-not (Test-Path -LiteralPath $docker)) {
  throw "Docker CLI was not found at $docker"
}

$dockerIsReady = $false
if (Test-DockerEngine -DockerPath $docker) {
  $dockerIsReady = $true
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDir = Join-Path $ProjectRoot ".backups\postgres-audit-$stamp"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$vhdPath = Join-Path $env:LOCALAPPDATA "Docker\wsl\disk\docker_data.vhdx"
if (Test-Path -LiteralPath $vhdPath) {
  $vhd = Get-Item -LiteralPath $vhdPath
  $vhdHash = $null
  $vhdHashNote = $null
  try {
    $vhdHash = Get-FileHash -LiteralPath $vhdPath -Algorithm SHA256
  } catch {
    $vhdHashNote = "Skipped SHA256 because Docker Desktop is using docker_data.vhdx. This is expected while Docker is open."
  }
  [ordered]@{
    capturedAt = (Get-Date).ToString("o")
    path = $vhd.FullName
    length = $vhd.Length
    creationTime = $vhd.CreationTime.ToString("o")
    lastWriteTime = $vhd.LastWriteTime.ToString("o")
    sha256 = if ($vhdHash) { $vhdHash.Hash } else { $null }
    sha256Note = $vhdHashNote
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir "docker-vhd-before-audit.json") -Encoding UTF8
}

if (-not $dockerIsReady) {
  if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $dockerDesktop
  }

  $deadline = (Get-Date).AddSeconds($DockerWaitSeconds)
  do {
    Start-Sleep -Seconds 3
    if (Test-DockerEngine -DockerPath $docker) {
      $dockerIsReady = $true
      break
    }
  } while ((Get-Date) -lt $deadline)
}

if (-not $dockerIsReady) {
  throw "Docker is open, but this window cannot access its engine. Close this window and double-click windows-audit-pl-chat-postgres.cmd directly in File Explorer. Do not use Run as administrator."
}

Invoke-Docker -DockerPath $docker -DockerArguments @("version") |
  Out-File -LiteralPath (Join-Path $outputDir "docker-version.txt") -Encoding UTF8
Invoke-Docker -DockerPath $docker -DockerArguments @("ps", "-a", "--no-trunc") |
  Out-File -LiteralPath (Join-Path $outputDir "docker-containers.txt") -Encoding UTF8
Invoke-Docker -DockerPath $docker -DockerArguments @("volume", "ls") |
  Out-File -LiteralPath (Join-Path $outputDir "docker-volumes.txt") -Encoding UTF8

$containers = @(Invoke-Docker -DockerPath $docker -DockerArguments @("ps", "-a", "--format", "{{.Names}}"))
$postgresContainers = @()
foreach ($container in $containers) {
  $inspect = Invoke-Docker -DockerPath $docker -DockerArguments @("inspect", $container) | ConvertFrom-Json
  $image = [string]$inspect[0].Config.Image
  $environment = @($inspect[0].Config.Env)
  $isPostgres = $image -match "(^|/)postgres(:|$)" -or $environment -match "^POSTGRES_(USER|DB|PASSWORD)="
  if (-not $isPostgres) {
    continue
  }

  $postgresContainers += $container
  $safeInspect = [ordered]@{
    name = $container
    image = $image
    state = $inspect[0].State.Status
    created = $inspect[0].Created
    mounts = @($inspect[0].Mounts | ForEach-Object {
      [ordered]@{
        type = $_.Type
        name = $_.Name
        source = $_.Source
        destination = $_.Destination
        mode = $_.Mode
        rw = $_.RW
      }
    })
  }
  $safeInspect | ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (Join-Path $outputDir "$container.inspect.json") -Encoding UTF8

  if ($inspect[0].State.Status -ne "running") {
    "Skipped database queries because container '$container' is not running." |
      Set-Content -LiteralPath (Join-Path $outputDir "$container.not-running.txt") -Encoding UTF8
    continue
  }

  $postgresUser = (($environment | Where-Object { $_ -like "POSTGRES_USER=*" }) -replace "^POSTGRES_USER=", "" | Select-Object -First 1)
  $postgresDb = (($environment | Where-Object { $_ -like "POSTGRES_DB=*" }) -replace "^POSTGRES_DB=", "" | Select-Object -First 1)
  if (-not $postgresUser) { $postgresUser = "postgres" }
  if (-not $postgresDb) { $postgresDb = $postgresUser }

  $tableSql = "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
  $tables = @(Invoke-PostgresSql -DockerPath $docker -Container $container -User $postgresUser -Database $postgresDb -Sql $tableSql)
  $tables | Set-Content -LiteralPath (Join-Path $outputDir "$container.tables.txt") -Encoding UTF8

  $summary = @()
  foreach ($table in $tables) {
    if ([string]::IsNullOrWhiteSpace($table)) { continue }

    $escapedTable = $table.Replace('"', '""')
    $countSql = "SELECT count(*) FROM public.`"$escapedTable`";"
    $count = (Invoke-PostgresSql -DockerPath $docker -Container $container -User $postgresUser -Database $postgresDb -Sql $countSql | Select-Object -First 1)

    $columnsSql = "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$($table.Replace("'", "''"))' AND column_name IN ('createdAt','updatedAt','uploadedAt','sentAt','readAt','deletedAt') ORDER BY column_name;"
    $dateColumns = @(Invoke-PostgresSql -DockerPath $docker -Container $container -User $postgresUser -Database $postgresDb -Sql $columnsSql)
    $latestDates = @()
    foreach ($column in $dateColumns) {
      if ([string]::IsNullOrWhiteSpace($column)) { continue }
      $escapedColumn = $column.Replace('"', '""')
      $maxSql = "SELECT max(`"$escapedColumn`") FROM public.`"$escapedTable`";"
      $maxValue = (Invoke-PostgresSql -DockerPath $docker -Container $container -User $postgresUser -Database $postgresDb -Sql $maxSql | Select-Object -First 1)
      if ($maxValue) {
        $latestDates += "$column=$maxValue"
      }
    }

    $summary += [pscustomobject]@{
      table = $table
      count = [long]$count
      latestDates = ($latestDates -join "; ")
    }
  }

  $summary |
    Sort-Object table |
    Export-Csv -LiteralPath (Join-Path $outputDir "$container.table-summary.csv") -NoTypeInformation -Encoding UTF8
}

if ($postgresContainers.Count -eq 0) {
  "No PostgreSQL containers were found. Existing Docker data was not modified by this script." |
    Set-Content -LiteralPath (Join-Path $outputDir "no-postgres-containers.txt") -Encoding UTF8
}

Write-Host ""
Write-Host "PL CHAT PostgreSQL audit completed." -ForegroundColor Green
Write-Host "Results: $outputDir"
Write-Host "No PL CHAT JSON file was changed."
Read-Host "Press Enter to close"
