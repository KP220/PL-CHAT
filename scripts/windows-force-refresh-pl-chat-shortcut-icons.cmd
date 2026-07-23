@echo off
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-force-refresh-pl-chat-shortcut-icons.ps1"
pause
