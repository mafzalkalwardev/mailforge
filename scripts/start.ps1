# MailForge — start Node app + truemail-go verifier (Windows)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $Root "..")

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example — edit JWT_SECRET and ENCRYPTION_KEY before production."
}

Write-Host "Starting MailForge on http://localhost:5000"
npm start
