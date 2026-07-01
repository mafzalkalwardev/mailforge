# MailForge portable launcher

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path (Join-Path $Root "package.json"))) {
    Write-Host "ERROR: Run this launcher from the MailForge app folder."
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example"
}

New-Item -ItemType Directory -Force -Path "data\mongodb" | Out-Null
New-Item -ItemType Directory -Force -Path "tools\mongodb-binaries" | Out-Null

Write-Host ""
Write-Host "Starting MailForge at http://localhost:5000"
Write-Host "Using embedded portable MongoDB."
Write-Host "Close this window to stop the server."
Write-Host ""

Start-Process "http://localhost:5000"
& cmd /c npm start
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "MailForge exited with an error. Run Client-Install-MailForge.bat once if dependencies are missing."
    Read-Host "Press Enter to exit"
}
