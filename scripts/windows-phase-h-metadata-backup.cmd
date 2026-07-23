@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0phase-h-backup-dr.mjs" --apply --metadata-only --json
endlocal
