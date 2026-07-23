@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0phase-i-security-hardening.mjs" %*
endlocal
