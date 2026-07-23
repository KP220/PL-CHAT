@echo off
setlocal
cd /d "%~dp0.."
node scripts\backup-pl-chat-data.mjs
