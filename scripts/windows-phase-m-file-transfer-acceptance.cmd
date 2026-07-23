@echo off
setlocal
cd /d "%~dp0.."
node scripts\phase-m-file-transfer-acceptance.mjs %*
endlocal
