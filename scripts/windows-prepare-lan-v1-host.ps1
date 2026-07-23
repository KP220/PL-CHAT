param(
  [int]$Port = 8788,
  [int]$MinioPort = 9000,
  [string]$HostIp = '',
  [switch]$OpenFirewall
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$configPath = Join-Path $root 'electron\desktop-config.json'
$statusDir = Join-Path $root 'pl-chat-data\lan-v1'
$statusPath = Join-Path $statusDir 'host-status.json'

function Write-Step {
  param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) -ForegroundColor $Color
}

function Get-PrivateIPv4 {
  $addresses = @()
  try {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -ne 'WellKnown' -and
        $_.AddressState -eq 'Preferred'
      } |
      Sort-Object InterfaceMetric, InterfaceIndex |
      ForEach-Object { $_.IPAddress }
  } catch {
    $addresses = @()
  }

  if (!$addresses -or !$addresses.Count) {
    try {
      $addresses = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).AddressList |
        Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
        ForEach-Object { $_.IPAddressToString } |
        Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }
    } catch {
      $addresses = @()
    }
  }

  foreach ($address in $addresses) {
    if ($address -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)') {
      return $address
    }
  }
  return ($addresses | Select-Object -First 1)
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Set-Location $root
New-Item -ItemType Directory -Path $statusDir -Force | Out-Null

if (!$HostIp) {
  $HostIp = Get-PrivateIPv4
}
if (!$HostIp) {
  throw 'No LAN IPv4 address was found. Connect the host computer to Wi-Fi and try again.'
}

$appUrl = "http://${HostIp}:$Port"
$minioUrl = "http://${HostIp}:$MinioPort"
@{
  appUrl = $appUrl
  minioUrl = $minioUrl
  mode = 'lan-only-v1'
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Step "Desktop config written: $configPath" Green
Write-Step "Client app URL: $appUrl" Green
Write-Step "Client MinIO transfer URL: $minioUrl" Green

if ($OpenFirewall) {
  $firewallPorts = @(
    @{ Port = $Port; Name = "PL CHAT LAN v1 $Port"; Purpose = 'PL CHAT app' },
    @{ Port = $MinioPort; Name = "PL CHAT MinIO Transfer $MinioPort"; Purpose = 'fast MinIO downloads' }
  )
  if (!(Test-IsAdmin)) {
    Write-Step 'Firewall rule was not created because this PowerShell session is not elevated.' Yellow
    foreach ($item in $firewallPorts) {
      Write-Step "Run as Administrator: New-NetFirewallRule -DisplayName '$($item.Name)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $($item.Port) -Profile Private" Yellow
    }
  } else {
    foreach ($item in $firewallPorts) {
      $existing = Get-NetFirewallRule -DisplayName $item.Name -ErrorAction SilentlyContinue
      if (!$existing) {
        New-NetFirewallRule -DisplayName $item.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $item.Port -Profile Private | Out-Null
        Write-Step "Firewall rule created: $($item.Name) ($($item.Purpose))" Green
      } else {
        Write-Step "Firewall rule already exists: $($item.Name)" DarkCyan
      }
    }
  }
}

$healthOk = $false
try {
  $response = Invoke-WebRequest -Uri "$appUrl/api/health" -UseBasicParsing -TimeoutSec 4
  $healthOk = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
} catch {
  $healthOk = $false
}

[pscustomobject]@{
  ok = $true
  appUrl = $appUrl
  minioUrl = $minioUrl
  hostIp = $HostIp
  port = $Port
  minioPort = $MinioPort
  healthOk = $healthOk
  configPath = $configPath
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8

if ($healthOk) {
  Write-Step 'Health check passed from the host computer.' Green
} else {
  Write-Step "Health check did not pass yet. Start PL CHAT Server, then test $appUrl/api/health" Yellow
}
Write-Step "Status saved: $statusPath" DarkCyan
