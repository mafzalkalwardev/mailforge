@echo off
title MailForge
cd /d "%~dp0"
echo Starting MailForge with persistent MongoDB...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-persistent.ps1"
if errorlevel 1 (
    echo.
    echo Failed to start. Run Client-Install-MailForge.bat once, then try again.
    pause
    exit /b 1
)
