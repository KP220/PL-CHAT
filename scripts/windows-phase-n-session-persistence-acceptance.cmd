@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0phase-n-session-persistence-acceptance.mjs" %*
