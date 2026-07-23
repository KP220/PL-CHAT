@echo off
setlocal
set "KAVEEP_ROOT=C:\Users\PC\Documents\Codex\2026-07-20\pl-chat-integration-api-kaveep-api"
if not exist "%KAVEEP_ROOT%\server.mjs" (
  echo KAVEEP Local Qwen integration was not found at %KAVEEP_ROOT%
  exit /b 1
)
cd /d "%KAVEEP_ROOT%"
"C:\Program Files\nodejs\node.exe" server.mjs
endlocal
