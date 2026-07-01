@echo off
setlocal
title Install and Run MailForge
cd /d "%~dp0"

call "%~dp0Client-Install-MailForge.bat"
if errorlevel 1 exit /b 1

set "APPDIR=%LOCALAPPDATA%\Programs\MailForge"
if exist "%APPDIR%\MailForge.exe" (
    start "" "%APPDIR%\MailForge.exe"
) else (
    start "" "%APPDIR%\Start-MailForge.bat"
)
