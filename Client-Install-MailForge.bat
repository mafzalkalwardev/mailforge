@echo off
setlocal
title MailForge Installer
cd /d "%~dp0"

echo.
echo ========================================
echo  MailForge Windows Installer
echo ========================================
echo.
echo This installs MailForge as a local desktop app with:
echo  - Embedded portable MongoDB data in the app folder
echo  - Start Menu and Desktop shortcuts
echo  - Windows uninstall entry
echo  - No Docker requirement
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
    echo.
    echo Install failed.
    pause
    exit /b 1
)

echo.
echo Install complete.
pause
