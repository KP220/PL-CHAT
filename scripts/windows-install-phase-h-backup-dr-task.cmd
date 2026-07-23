@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-install-phase-h-backup-dr-task.ps1"
endlocal
