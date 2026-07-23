$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}

$repoPath = $root.Path
if ($repoPath -match '^([A-Za-z]:\\Users\\[^\\]+)\\') {
  $userProfile = $Matches[1]
} else {
  $userProfile = $env:USERPROFILE
}

$userLocalAppData = Join-Path $userProfile "AppData\Local"
$userRoamingAppData = Join-Path $userProfile "AppData\Roaming"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Invoke-Native($command, $arguments) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$command failed with exit code $LASTEXITCODE"
  }
}

function New-AppShortcut($shortcutPath, $targetPath, $workingDirectory, $iconPath = $null) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $workingDirectory
  if ($iconPath -and (Test-Path -LiteralPath $iconPath)) {
    $shortcut.IconLocation = "$iconPath,0"
  } else {
    $shortcut.IconLocation = "$targetPath,0"
  }
  $shortcut.Save()
}

function Write-DesktopPreferences() {
  $preferencesDir = Join-Path $userRoamingAppData "PL CHAT"
  $preferencesPath = Join-Path $preferencesDir "desktop-preferences.json"
  $preferences = @{
    minimizeToTray = $true
    notificationsEnabled = $true
    doNotDisturb = $false
    startWithWindows = $true
  }

  if (Test-Path -LiteralPath $preferencesPath) {
    try {
      $existing = Get-Content -LiteralPath $preferencesPath -Raw | ConvertFrom-Json
      foreach ($property in $existing.PSObject.Properties) {
        $preferences[$property.Name] = $property.Value
      }
      $preferences["minimizeToTray"] = $true
      $preferences["startWithWindows"] = $true
    } catch {
      Write-Host "Could not read existing desktop preferences. Writing defaults." -ForegroundColor Yellow
    }
  }

  New-Item -ItemType Directory -Force -Path $preferencesDir | Out-Null
  $preferences | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $preferencesPath -Encoding UTF8
}

function Install-UnpackedApp($sourceDir) {
  $installDir = Join-Path $userLocalAppData "Programs\PL CHAT"
  $installRoot = Join-Path $userLocalAppData "Programs"
  $targetExe = Join-Path $installDir "PL CHAT.exe"

  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "PL CHAT.exe"))) {
    throw "PL CHAT.exe was not found in $sourceDir"
  }

  Write-Step "Installing PL CHAT from the packaged app folder"
  if (Test-Path -LiteralPath $installDir) {
    $resolvedInstall = (Resolve-Path -LiteralPath $installDir).Path
    $resolvedRoot = (Resolve-Path -LiteralPath $installRoot).Path
    if (-not $resolvedInstall.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Install directory is outside the expected Programs folder."
    }
    Remove-Item -LiteralPath $installDir -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  Copy-Item -Path (Join-Path $sourceDir "*") -Destination $installDir -Recurse -Force

  $desktopShortcut = Join-Path $userProfile "Desktop\PL CHAT.lnk"
  $startMenuDir = Join-Path $userRoamingAppData "Microsoft\Windows\Start Menu\Programs"
  $startMenuShortcut = Join-Path $startMenuDir "PL CHAT.lnk"
  $startupDir = Join-Path $userRoamingAppData "Microsoft\Windows\Start Menu\Programs\Startup"
  $startupShortcut = Join-Path $startupDir "PL CHAT.lnk"
  $iconPath = Join-Path $installDir "assets\icon.ico"

  New-AppShortcut $desktopShortcut $targetExe $installDir $iconPath
  New-AppShortcut $startMenuShortcut $targetExe $installDir $iconPath
  New-AppShortcut $startupShortcut $targetExe $installDir $iconPath
  Write-DesktopPreferences

  Write-Step "Launching PL CHAT"
  Start-Process -FilePath $targetExe
  Write-Host "PL CHAT is installed and running."
}

Write-Step "Removing PL CHAT preview shortcuts"
$previewShortcutPaths = @(
  (Join-Path $userProfile "Desktop\PL CHAT Preview.lnk"),
  (Join-Path $userRoamingAppData "Microsoft\Windows\Start Menu\Programs\PL CHAT Preview.lnk")
)

foreach ($shortcutPath in $previewShortcutPaths) {
  if (Test-Path -LiteralPath $shortcutPath) {
    try {
      Remove-Item -LiteralPath $shortcutPath -Force
      Write-Host "Removed: $shortcutPath"
    } catch {
      Write-Host "Could not remove preview shortcut here. You can delete it manually later: $shortcutPath" -ForegroundColor Yellow
    }
  }
}

Write-Step "Preparing production desktop web bundle"
$env:EXPO_NO_TELEMETRY = "1"
$env:EXPO_HOME = Join-Path $root ".expo"
$env:ELECTRON_BUILDER_CACHE = Join-Path $root ".electron-builder-cache"

try {
  Invoke-Native "npm.cmd" @("run", "web:export")
} catch {
  Write-Host "Expo export was not available. Using the latest prepared PL CHAT web bundle." -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path "dist\web" | Out-Null
  Copy-Item -Path "preview-desktop\*" -Destination "dist\web" -Recurse -Force
}

Write-Step "Building PL CHAT Windows installer"
$installerReady = $true
try {
  Invoke-Native "npx.cmd" @("electron-builder", "--win")
} catch {
  $installerReady = $false
  Write-Host "Windows Setup could not be created. Falling back to direct desktop installation." -ForegroundColor Yellow
}

Write-Step "Installing PL CHAT"
$setup = Get-ChildItem -Path "release" -Filter "*Setup*.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installerReady -or -not $setup) {
  $unpackedDir = Join-Path $root "release\win-unpacked"
  Install-UnpackedApp $unpackedDir
  exit 0
}

Write-Host "Installer: $($setup.FullName)"
Start-Process -FilePath $setup.FullName -ArgumentList "/S" -Wait

$installedExe = Join-Path $userLocalAppData "Programs\PL CHAT\PL CHAT.exe"
if (Test-Path -LiteralPath $installedExe) {
  Write-DesktopPreferences
  Write-Step "Launching PL CHAT"
  Start-Process -FilePath $installedExe
  Write-Host "PL CHAT is installed and running."
} else {
  Write-Host "PL CHAT installer finished. Open PL CHAT from the Desktop or Start Menu." -ForegroundColor Yellow
}
