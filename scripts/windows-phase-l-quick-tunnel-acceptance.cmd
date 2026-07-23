@echo off
setlocal
cd /d "%~dp0.."
node scripts\phase-l-quick-tunnel-acceptance.mjs %*
endlocal
