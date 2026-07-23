@echo off
setlocal
cd /d "%~dp0\.."
node scripts\phase-o-desktop-update-center-acceptance.mjs
