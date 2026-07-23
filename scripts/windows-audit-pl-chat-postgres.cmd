@echo off
setlocal
title PL CHAT PostgreSQL Recovery Audit
echo ============================================================
echo PL CHAT PostgreSQL Recovery Audit
echo Keep Docker Desktop open. Do NOT run this file as administrator.
echo No PL CHAT chat data will be changed by this audit.
echo ============================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-audit-pl-chat-postgres.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
if not "%exitCode%"=="0" (
  echo Audit stopped with error code %exitCode%.
  echo Please leave this window open and send a screenshot.
) else (
  echo Audit finished successfully.
)
echo.
pause
endlocal
