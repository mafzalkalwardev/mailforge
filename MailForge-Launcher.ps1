# MailForge launcher - place MailForge.exe in the project folder (next to package.json)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Test-Path (Join-Path $Root "package.json"))) {
    Write-Host "ERROR: Run MailForge.exe from the MailForge project folder (where package.json is)."
    Read-Host "Press Enter to exit"
    exit 1
}

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
        Write-Host "ERROR: Failed to start MongoDB container."
        Read-Host "Press Enter to exit"
        exit 1
    }

    $deadline = (Get-Date).AddSeconds(45)
    do {
        $health = & docker inspect --format "{{.State.Health.Status}}" mailforge-mongo 2>$null
        if ($health -eq "healthy") { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    if ($health -ne "healthy") {
        Write-Warning "MongoDB not healthy yet - app will retry connection."
    } else {
        Write-Host "MongoDB ready at mongodb://127.0.0.1:27017/mailforge"
    }
} else {
    Write-Warning "Docker Desktop is not running. Start it first for persistent data."
}

Write-Host ""
Write-Host "Starting MailForge at http://localhost:5000"
Write-Host "Close this window to stop the server."
Write-Host ""

& cmd /c npm start
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "MailForge exited with an error. Run npm install in this folder if needed."
    Read-Host "Press Enter to exit"
}
