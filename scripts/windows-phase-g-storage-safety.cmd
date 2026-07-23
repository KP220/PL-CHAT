@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0phase-g-storage-safety.mjs" %*
endlocal
