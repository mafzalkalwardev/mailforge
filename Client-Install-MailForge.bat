@echo off
setlocal EnableExtensions EnableDelayedExpansion
title MailForge Client Installer
cd /d "%~dp0"

set "CHECK_ONLY="
if /I "%~1"=="--check" set "CHECK_ONLY=1"

echo.
echo ========================================
echo  MailForge Client Installer
echo ========================================
echo.

if not exist "package.json" (
    echo ERROR: Run this file from the MailForge project folder.
    pause
    exit /b 1
)

call :detect node NEED_NODE "Node.js 18+" "OpenJS.NodeJS.LTS"
call :detect npm NEED_NODE "npm" "OpenJS.NodeJS.LTS"
call :detect go NEED_GO "Go 1.22+" "GoLang.Go"
call :detect docker NEED_DOCKER "Docker Desktop" "Docker.DockerDesktop"

if defined NEED_NODE (
    set "HAS_MISSING=1"
)
if defined NEED_GO (
    set "HAS_MISSING=1"
)
if defined NEED_DOCKER (
    set "HAS_MISSING=1"
)

if defined HAS_MISSING (
    echo.
    echo Some required tools are missing.
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Install the missing tools from SETUP.md, then run this file again.
        pause
        exit /b 1
    )

    if defined CHECK_ONLY (
        echo Check mode: skipping winget installs.
        exit /b 1
    )

    echo.
    choice /C YN /N /M "Install missing tools with winget now? [Y/N] "
    if errorlevel 2 (
        echo Install cancelled.
        pause
        exit /b 1
    )

    if defined NEED_NODE call :winget_install "OpenJS.NodeJS.LTS" "Node.js"
    if defined NEED_GO call :winget_install "GoLang.Go" "Go"
    if defined NEED_DOCKER call :winget_install "Docker.DockerDesktop" "Docker Desktop"

    echo.
    echo Prerequisites were requested through winget.
    echo Close this window, restart your terminal, start Docker Desktop, then run this file again.
    pause
    exit /b 0
)

echo.
echo All prerequisites found.

if defined CHECK_ONLY (
    echo Check mode complete. No install or services were started.
    exit /b 0
)

if not exist ".env" (
    if not exist ".env.example" (
        echo ERROR: .env.example is missing.
        pause
        exit /b 1
    )
    copy ".env.example" ".env" >nul
    echo Created .env from .env.example
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='.env'; $jwt=-join ((48..57+65..90+97..122)|Get-Random -Count 64|%%{[char]$_}); $enc=-join ((48..57+65..90+97..122)|Get-Random -Count 64|%%{[char]$_}); (Get-Content $p) -replace '^JWT_SECRET=.*',('JWT_SECRET='+$jwt) -replace '^ENCRYPTION_KEY=.*',('ENCRYPTION_KEY='+$enc) | Set-Content $p -Encoding ascii"
    if errorlevel 1 (
        echo WARNING: Could not auto-fill secrets. Edit .env before production use.
    ) else (
        echo Generated JWT_SECRET and ENCRYPTION_KEY in .env
    )
) else (
    echo .env already exists.
)

echo.
echo Installing Node packages...
if exist "package-lock.json" (
    call npm ci
) else (
    call npm install
)
if errorlevel 1 (
    echo ERROR: Node package install failed.
    pause
    exit /b 1
)

echo.
echo Setting up Go verifier...
call npm run setup:go
if errorlevel 1 (
    echo ERROR: Go verifier setup failed.
    pause
    exit /b 1
)

echo.
echo Starting local MongoDB with Docker...
docker info >nul 2>nul
if errorlevel 1 (
    echo WARNING: Docker Desktop is installed but not running.
    echo Start Docker Desktop, then run: npm run mongo:up
) else (
    docker compose -f docker-compose.mongo.yml up -d
    if errorlevel 1 (
        echo ERROR: MongoDB container failed to start.
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo  MailForge is ready
echo ========================================
echo.
echo Opening http://localhost:5000
echo Keep this window open while MailForge is running.
echo.
start "" "http://localhost:5000"
call npm start
pause
exit /b 0

:detect
where %~1 >nul 2>nul
if errorlevel 1 (
    echo MISSING: %~3
    set "%~2=1"
) else (
    for /f "tokens=*" %%v in ('%~1 --version 2^>nul') do (
        echo OK: %~3 - %%v
        goto :eof
    )
    echo OK: %~3
)
goto :eof

:winget_install
echo.
echo Installing %~2...
winget install -e --id %~1 --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo ERROR: winget failed to install %~2.
    pause
    exit /b 1
)
goto :eof
