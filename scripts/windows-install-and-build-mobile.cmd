@echo off
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-install-and-build-mobile.ps1"
endlocal
