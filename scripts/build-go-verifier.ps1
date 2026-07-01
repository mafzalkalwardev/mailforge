$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$GoDir = Join-Path $Root "backend\go"
$Out = Join-Path $GoDir "verifier.exe"

function Resolve-Go {
    $cmd = Get-Command go -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $paths = @(
        "$env:ProgramFiles\Go\bin\go.exe",
        "${env:ProgramFiles(x86)}\Go\bin\go.exe"
    )
    foreach ($path in $paths) {
        if ($path -and (Test-Path $path)) {
            $env:Path = "$(Split-Path -Parent $path);$env:Path"
            return $path
        }
    }

    return $null
}

$GoExe = Resolve-Go
if (-not $GoExe) {
    throw "Go was not found. Re-run Client-Install-MailForge.bat so it can install Go, or install Go from https://go.dev/dl/."
}

Push-Location $GoDir
try {
    Write-Host "Building portable truemail-go verifier..."
    & $GoExe mod download
    if ($LASTEXITCODE -ne 0) { throw "go mod download failed" }

    & $GoExe build -trimpath -ldflags "-s -w" -o $Out .
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Out)) { throw "go build failed" }

    Write-Host "Built $Out"
} finally {
    Pop-Location
}
