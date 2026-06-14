# MailForge - New PC setup script
# Usage: npm run setup:new-pc

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

Write-Host "========================================"
Write-Host " MailForge - New PC Setup"
Write-Host "========================================"
Write-Host ""

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

$missing = @()
if (-not (Test-Command node)) { $missing += "Node.js (https://nodejs.org/)" }
if (-not (Test-Command docker)) { $missing += "Docker Desktop (https://docker.com/products/docker-desktop/)" }
if (-not (Test-Command go)) { $missing += "Go 1.22+ (https://go.dev/dl/)" }

if ($missing.Count) {
    Write-Host "Missing prerequisites:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  - $_" }
    Write-Host ""
    Write-Host "Install the above, then run this script again."
    exit 1
}

Write-Host "[1/5] Node $(node -v) OK"
Write-Host "[2/5] Go $(go version) OK"

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[3/5] Created .env from .env.example"
    Write-Host "      IMPORTANT: Edit .env and set JWT_SECRET + ENCRYPTION_KEY"
} else {
    Write-Host "[3/5] .env already exists"
}

Write-Host "[4/5] Installing npm dependencies..."
cmd /c npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "      Setting up Go verifier..."
cmd /c npm run setup:go

Write-Host "[5/5] Starting MongoDB (Docker)..."
try {
    & docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        & docker compose -f docker-compose.mongo.yml up -d
        Write-Host "      MongoDB container started"
    } else {
        Write-Warning "Docker is not running. Start Docker Desktop, then: npm run mongo:up"
    }
} catch {
    Write-Warning "Could not start Docker MongoDB: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Optional: build desktop launcher..."
try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "build-exe.ps1")
} catch {
    Write-Warning "Could not build MailForge.exe (needs .NET Framework). Use Start-MailForge.bat instead."
}

Write-Host ""
Write-Host "========================================"
Write-Host " Setup complete!"
Write-Host "========================================"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit .env (JWT_SECRET, ENCRYPTION_KEY)"
Write-Host "  2. npm run start:easy"
Write-Host "  3. Open http://localhost:5000 and register"
Write-Host ""
Write-Host "See SETUP.md for full documentation."
