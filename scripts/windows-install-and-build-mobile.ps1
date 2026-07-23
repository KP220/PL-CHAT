$ErrorActionPreference = "Stop"

$nodeDir = "C:\Program Files\nodejs"
$env:Path = "$nodeDir;$env:Path"

Write-Host "Checking Node.js..." -ForegroundColor Cyan
& "$nodeDir\node.exe" --version
& "$nodeDir\npm.cmd" --version

Write-Host "Checking npm registry..." -ForegroundColor Cyan
Test-NetConnection registry.npmjs.org -Port 443

Write-Host "Installing root dependencies..." -ForegroundColor Cyan
& "$nodeDir\npm.cmd" install --legacy-peer-deps

Write-Host "Installing API dependencies..." -ForegroundColor Cyan
Push-Location apps\api
& "$nodeDir\npm.cmd" install
& "$nodeDir\npm.cmd" run prisma:generate
& "$nodeDir\npm.cmd" run typecheck
Pop-Location

Write-Host "Installing web dashboard dependencies..." -ForegroundColor Cyan
Push-Location apps\web
& "$nodeDir\npm.cmd" install
& "$nodeDir\npm.cmd" run typecheck
Pop-Location

Write-Host "Root typecheck..." -ForegroundColor Cyan
& "$nodeDir\npx.cmd" tsc --noEmit

Write-Host "Checking EAS CLI..." -ForegroundColor Cyan
& "$nodeDir\npx.cmd" eas --version

Write-Host "Ready. To build Android APK, run:" -ForegroundColor Green
Write-Host "npm.cmd run build:android:apk"
