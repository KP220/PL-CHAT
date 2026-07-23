param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$ReleaseNotes = 'Manual LAN desktop update from host.',
  [string]$ProjectRoot = '',
  [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ResolvedProjectRoot = if ($ProjectRoot) { (Resolve-Path -LiteralPath $ProjectRoot).Path } else { (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..')).Path }

if (-not (Test-Path -LiteralPath $InstallerPath)) {
  throw "Installer not found: $InstallerPath"
}

$resolvedInstaller = Resolve-Path -LiteralPath $InstallerPath
$targetDataDir = if ($DataDir) { $DataDir } else { Join-Path $ResolvedProjectRoot 'trial-data' }
$updateDir = Join-Path $targetDataDir 'desktop-updates'
New-Item -ItemType Directory -Path $updateDir -Force | Out-Null

$safeName = Split-Path -Leaf $resolvedInstaller
$targetInstaller = Join-Path $updateDir $safeName
Copy-Item -LiteralPath $resolvedInstaller -Destination $targetInstaller -Force

$file = Get-Item -LiteralPath $targetInstaller
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetInstaller).Hash
$manifest = [ordered]@{
  version = $Version
  channel = 'lan-manual'
  fileName = $safeName
  sizeBytes = $file.Length
  sha256 = $hash
  releaseNotes = $ReleaseNotes
  publishedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$manifestJson = $manifest | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $updateDir 'latest.json'), "$manifestJson`n", $utf8NoBom)

Write-Host "Published PL CHAT desktop update"
Write-Host "Version: $Version"
Write-Host "Installer: $targetInstaller"
Write-Host "SHA256: $hash"
Write-Host "Manifest: $(Join-Path $updateDir 'latest.json')"
