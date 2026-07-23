@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0phase-j-ops-monitor.mjs" %*
endlocal
