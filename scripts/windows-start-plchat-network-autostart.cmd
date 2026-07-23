@echo off
setlocal
title PL CHAT Network Autostart
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-start-plchat-network-autostart.ps1"
endlocal
