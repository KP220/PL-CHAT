$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$rootText = $root.Path
if ($rootText -notmatch '^([A-Za-z]:\\Users\\[^\\]+)\\') {
  throw "Cannot determine the Windows user profile from project path: $rootText"
}
$userProfile = $Matches[1]
$userLocalAppData = Join-Path $userProfile "AppData\Local"
$userRoamingAppData = Join-Path $userProfile "AppData\Roaming"
$sourceDir = Join-Path $root "release\win-unpacked"
$installRoot = Join-Path $userLocalAppData "Programs"
$installDir = Join-Path $installRoot "PL CHAT"
$targetExe = Join-Path $installDir "PL CHAT.exe"
$iconPath = Join-Path $installDir "assets\icon.ico"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Assert-SafePath($path, $rootPath) {
  $full = [System.IO.Path]::GetFullPath($path)
  $rootFull = [System.IO.Path]::GetFullPath($rootPath)
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe path: $full"
  }
}

function New-OrUpdateShortcut($shortcutPath, $targetPath, $workingDirectory, $shortcutIconPath) {
  $shortcutDirectory = Split-Path -Parent $shortcutPath
  New-Item -ItemType Directory -Force -Path $shortcutDirectory | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.IconLocation = if (Test-Path -LiteralPath $shortcutIconPath) { "$shortcutIconPath,0" } else { "$targetPath,0" }
  $shortcut.Description = "PL CHAT Internal Workspace"
  $shortcut.Save()
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "PL CHAT.exe"))) {
  throw "Build output was not found. Run electron-builder first."
}

Assert-SafePath $installDir $installRoot

Write-Step "Closing running PL CHAT desktop windows"
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.EndsWith("PL CHAT.exe", [System.StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force

Write-Step "Installing latest PL CHAT desktop app"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Path (Join-Path $sourceDir "*") -Destination $installDir -Recurse -Force

Write-Step "Updating shortcuts with the PL CHAT logo"
$desktopDir = Join-Path $userProfile "Desktop"
$startMenuDir = Join-Path $userRoamingAppData "Microsoft\Windows\Start Menu\Programs"
$startupDir = Join-Path $startMenuDir "Startup"

$shortcutPaths = @(
  (Join-Path $desktopDir "PL CHAT.lnk"),
  (Join-Path $startMenuDir "PL CHAT.lnk"),
  (Join-Path $startupDir "PL CHAT.lnk")
)

$existingShortcuts = @(
  Get-ChildItem -Path $desktopDir -Filter "*PL*CHAT*.lnk" -ErrorAction SilentlyContinue
  Get-ChildItem -Path $startMenuDir -Filter "*PL*CHAT*.lnk" -ErrorAction SilentlyContinue
  Get-ChildItem -Path $startupDir -Filter "*PL*CHAT*.lnk" -ErrorAction SilentlyContinue
) | Where-Object { $_ } | Select-Object -ExpandProperty FullName

$shortcutPaths = @($shortcutPaths + $existingShortcuts) | Sort-Object -Unique
foreach ($shortcutPath in $shortcutPaths) {
  New-OrUpdateShortcut $shortcutPath $targetExe $installDir $iconPath
  Write-Host "Shortcut updated: $shortcutPath" -ForegroundColor Green
}

Write-Step "Enabling start with Windows"
$preferenceDir = Join-Path $userRoamingAppData "PL CHAT"
$preferencePath = Join-Path $preferenceDir "desktop-preferences.json"
New-Item -ItemType Directory -Force -Path $preferenceDir | Out-Null
$preferences = @{
  minimizeToTray = $true
  notificationsEnabled = $true
  doNotDisturb = $false
  startWithWindows = $true
}
if (Test-Path -LiteralPath $preferencePath) {
  try {
    $existing = Get-Content -LiteralPath $preferencePath -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) {
      $preferences[$property.Name] = $property.Value
    }
    $preferences["startWithWindows"] = $true
    $preferences["minimizeToTray"] = $true
  } catch {
    # Keep safe defaults if the preference file is damaged.
  }
}
$preferences | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $preferencePath -Encoding UTF8

Write-Step "Refreshing Windows icon cache hint"
Start-Process -FilePath "$env:WINDIR\System32\ie4uinit.exe" -ArgumentList "-show" -WindowStyle Hidden -ErrorAction SilentlyContinue

Write-Step "Launching PL CHAT"
Start-Process -FilePath $targetExe

Write-Host ""
Write-Host "PL CHAT icon, shortcuts, and Windows startup are ready." -ForegroundColor Green
