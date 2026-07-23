$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$rootText = $root.Path
if ($rootText -notmatch '^([A-Za-z]:\\Users\\[^\\]+)\\') {
  throw "Cannot determine the Windows user profile from project path: $rootText"
}

$userProfile = $Matches[1]
$userLocalAppData = Join-Path $userProfile "AppData\Local"
$userRoamingAppData = Join-Path $userProfile "AppData\Roaming"
$desktopDir = Join-Path $userProfile "Desktop"
$startMenuDir = Join-Path $userRoamingAppData "Microsoft\Windows\Start Menu\Programs"
$startupDir = Join-Path $startMenuDir "Startup"
$installDir = Join-Path $userLocalAppData "Programs\PL CHAT"
$targetExe = Join-Path $installDir "PL CHAT.exe"
$sourceIcon = Join-Path $root "assets\icon.ico"
$iconStore = Join-Path $userRoamingAppData "PL CHAT\icons"
$forcedIcon = Join-Path $iconStore ("plchat-logo-" + (Get-Date -Format "yyyyMMddHHmmss") + ".ico")

function New-OrUpdateShortcut($shortcutPath, $targetPath, $workingDirectory, $shortcutIconPath) {
  $shortcutDirectory = Split-Path -Parent $shortcutPath
  New-Item -ItemType Directory -Force -Path $shortcutDirectory | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.IconLocation = "$shortcutIconPath,0"
  $shortcut.Description = "PL CHAT Internal Workspace"
  $shortcut.Save()
}

if (-not (Test-Path -LiteralPath $targetExe)) {
  throw "PL CHAT installed app was not found: $targetExe"
}
if (-not (Test-Path -LiteralPath $sourceIcon)) {
  throw "PL CHAT icon was not found: $sourceIcon"
}

New-Item -ItemType Directory -Force -Path $iconStore | Out-Null
Copy-Item -LiteralPath $sourceIcon -Destination $forcedIcon -Force

$shortcutPaths = @(
  (Join-Path $desktopDir "PL CHAT.lnk"),
  (Join-Path $startMenuDir "PL CHAT.lnk"),
  (Join-Path $startupDir "PL CHAT.lnk")
)

$oldDesktopNames = @(
  (Join-Path $desktopDir "PL CHAT - Shortcut.lnk")
)

foreach ($oldShortcut in $oldDesktopNames) {
  if (Test-Path -LiteralPath $oldShortcut) {
    Remove-Item -LiteralPath $oldShortcut -Force
  }
}

foreach ($shortcutPath in $shortcutPaths) {
  if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
  }
  New-OrUpdateShortcut $shortcutPath $targetExe $installDir $forcedIcon
  Write-Host "Shortcut refreshed: $shortcutPath" -ForegroundColor Green
}

Start-Process -FilePath "$env:WINDIR\System32\ie4uinit.exe" -ArgumentList "-show" -WindowStyle Hidden -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "PL CHAT shortcut icons were refreshed. If Windows still shows the old icon, press F5 on the desktop or restart Windows once." -ForegroundColor Green
