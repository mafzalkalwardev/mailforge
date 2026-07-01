# MailForge - start portable desktop app with embedded MongoDB

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example"
}

New-Item -ItemType Directory -Force -Path "data\mongodb" | Out-Null
New-Item -ItemType Directory -Force -Path "tools\mongodb-binaries" | Out-Null

Write-Host "Starting MailForge with embedded portable MongoDB..."
Write-Host "Data folder: $Root\data\mongodb"
Write-Host "Open http://localhost:5000"
cmd /c npm start
