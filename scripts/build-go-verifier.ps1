$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$GoDir = Join-Path $Root "backend\go"
$Out = Join-Path $GoDir "verifier.exe"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "Go was not found. Install Go once to build backend\go\verifier.exe, or ship a package that already includes verifier.exe."
}

Push-Location $GoDir
try {
    Write-Host "Building portable truemail-go verifier..."
    & go mod download
    if ($LASTEXITCODE -ne 0) { throw "go mod download failed" }

    & go build -trimpath -ldflags "-s -w" -o $Out .
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Out)) { throw "go build failed" }

    Write-Host "Built $Out"
} finally {
    Pop-Location
}
