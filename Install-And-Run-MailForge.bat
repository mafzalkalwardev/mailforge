@echo off
setlocal
title MailForge Client Installer
cd /d "%~dp0"

echo.
echo ========================================
echo  MailForge local client setup
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed.
    echo Install Node.js 18 LTS or newer from https://nodejs.org, then run this file again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm was not found. Reinstall Node.js 18 LTS or newer, then run this file again.
    pause
    exit /b 1
)

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo Created .env from .env.example
    ) else (
        echo Missing .env.example. Please add a .env file before starting.
        pause
        exit /b 1
    )
)

if not exist "node_modules" (
    echo Installing MailForge packages...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
) else (
    echo Packages already installed.
)

where docker >nul 2>nul
if errorlevel 1 (
    echo Docker was not found. MailForge will start, but persistent local MongoDB needs Docker Desktop.
    echo Install Docker Desktop for client production use, or configure MONGO_URI in .env.
) else (
    echo Starting local MongoDB...
    docker compose -f docker-compose.mongo.yml up -d
)

echo.
echo Opening MailForge at http://localhost:5000
start "" "http://localhost:5000"
echo.
echo Keep this window open while MailForge is running.
echo.
call npm start

pause
