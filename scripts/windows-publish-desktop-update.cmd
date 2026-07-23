@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-publish-desktop-update.ps1" %*
exit /b %ERRORLEVEL%
