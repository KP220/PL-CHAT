@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-enable-minio-portable-storage.ps1" %*
endlocal
