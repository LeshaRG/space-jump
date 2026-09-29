@echo off
cd /d "%~dp0"
title Space Jump - local server

set PORT=5173

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found. Install it from https://nodejs.org and run this file again.
    pause
    exit /b 1
)

rem Addresses for the PC and the phone are printed by dev-server.js itself:
rem it detects the computer's LAN IP, so nothing is hardcoded here.
node dev-server.js

pause
