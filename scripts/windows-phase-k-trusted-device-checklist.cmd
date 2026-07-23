@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0phase-k-trusted-device-checklist.mjs" %*
endlocal
