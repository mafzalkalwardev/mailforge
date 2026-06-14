# MailForge - start local MongoDB (Docker) + Node app (persistent data)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example"
}

function Test-DockerRunning {
    try {
        & docker info 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

$health = ""

if (Test-DockerRunning) {
    Write-Host "Starting local MongoDB (Docker)..."
    & docker compose -f docker-compose.mongo.yml up -d
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start MongoDB container"
    }

    $deadline = (Get-Date).AddSeconds(45)
    do {
        $health = & docker inspect --format "{{.State.Health.Status}}" mailforge-mongo 2>$null
        if ($health -eq "healthy") { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    if ($health -ne "healthy") {
        Write-Warning "MongoDB container not healthy yet - app will retry on startup."
    } else {
        Write-Host "MongoDB ready at mongodb://127.0.0.1:27017/mailforge"
    }
} else {
    Write-Warning "Docker not running. Start Docker Desktop, then run: npm run mongo:up"
}

Write-Host "Starting MailForge on http://localhost:5000"
cmd /c npm start
