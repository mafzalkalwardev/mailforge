param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\MailForge"),
    [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"
$SourceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)

function Require-Command {
    param(
        [string]$Name,
        [string]$WingetId,
        [string]$DisplayName
    )

    if (Get-Command $Name -ErrorAction SilentlyContinue) {
        return
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$DisplayName is required. Install it first, then run this installer again."
    }

    Write-Host "Installing $DisplayName with winget..."
    & winget install -e --id $WingetId --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed to install $DisplayName"
    }

    Update-ProcessPath

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$DisplayName was installed, but this installer window cannot see it yet. Close this window and run Client-Install-MailForge.bat again."
    }
}

function Update-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $extraPaths = @(
        "$env:ProgramFiles\Go\bin",
        "$env:ProgramFiles\nodejs",
        "${env:ProgramFiles(x86)}\nodejs"
    ) | Where-Object { $_ -and (Test-Path $_) }

    $env:Path = @($machinePath, $userPath, ($extraPaths -join ";")) -join ";"
}

function New-Shortcut {
    param(
        [string]$Path,
        [string]$Target,
        [string]$WorkingDirectory,
        [string]$Description
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Description = $Description
    $shortcut.IconLocation = $Target
    $shortcut.Save()
}

Write-Host "MailForge Windows Installer"
Write-Host "Installing to $InstallDir"

Update-ProcessPath
Require-Command -Name "node" -WingetId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
Require-Command -Name "npm" -WingetId "OpenJS.NodeJS.LTS" -DisplayName "npm"

if (-not (Test-Path (Join-Path $SourceDir "backend\go\verifier.exe"))) {
    Require-Command -Name "go" -WingetId "GoLang.Go" -DisplayName "Go"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if ($SourceDir -ne $InstallDir) {
    Write-Host "Copying application files..."
    $excludeDirs = @(".git", "node_modules", "data", "logs", "uploads", ".cache")
    $excludeFiles = @(".env", "*.log", "*.xlsx", "*.csv")
    $args = @($SourceDir, $InstallDir, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    foreach ($dir in $excludeDirs) { $args += @("/XD", (Join-Path $SourceDir $dir)) }
    foreach ($file in $excludeFiles) { $args += @("/XF", $file) }
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "File copy failed with robocopy exit code $LASTEXITCODE" }
}

Push-Location $InstallDir
try {
    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
        $chars = (48..57) + (65..90) + (97..122)
        $jwt = -join ($chars | Get-Random -Count 64 | ForEach-Object { [char]$_ })
        $enc = -join ($chars | Get-Random -Count 64 | ForEach-Object { [char]$_ })
        (Get-Content ".env") `
            -replace '^JWT_SECRET=.*', "JWT_SECRET=$jwt" `
            -replace '^ENCRYPTION_KEY=.*', "ENCRYPTION_KEY=$enc" `
            -replace '^MAILFORGE_DB_MODE=.*', "MAILFORGE_DB_MODE=embedded" `
            | Set-Content ".env" -Encoding ascii
    }

    New-Item -ItemType Directory -Force -Path "data\mongodb" | Out-Null
    New-Item -ItemType Directory -Force -Path "tools\mongodb-binaries" | Out-Null

    Write-Host "Installing production Node packages..."
    if (Test-Path "package-lock.json") {
        & npm ci --omit=dev
    } else {
        & npm install --omit=dev
    }
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    Write-Host "Building verifier and preparing embedded MongoDB..."
    & npm run build:go
    if ($LASTEXITCODE -ne 0) { throw "Go verifier build failed" }

    & node scripts/prepare-portable-mongo.mjs
    if ($LASTEXITCODE -ne 0) { throw "Portable MongoDB preparation failed" }

    Write-Host "Building MailForge.exe launcher..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-exe.ps1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "MailForge.exe")) {
        Write-Warning "Could not build MailForge.exe. Shortcuts will use Start-MailForge.bat."
    }
} finally {
    Pop-Location
}

$launcher = Join-Path $InstallDir "MailForge.exe"
if (-not (Test-Path $launcher)) {
    $launcher = Join-Path $InstallDir "Start-MailForge.bat"
}

$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\MailForge"
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
New-Shortcut -Path (Join-Path $startMenuDir "MailForge.lnk") -Target $launcher -WorkingDirectory $InstallDir -Description "MailForge"

if (-not $NoDesktopShortcut) {
    New-Shortcut -Path (Join-Path ([Environment]::GetFolderPath("Desktop")) "MailForge.lnk") -Target $launcher -WorkingDirectory $InstallDir -Description "MailForge"
}

$uninstall = Join-Path $InstallDir "scripts\uninstall-windows.ps1"
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MailForge"
New-Item -Path $regPath -Force | Out-Null
New-ItemProperty -Path $regPath -Name "DisplayName" -Value "MailForge" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name "DisplayVersion" -Value ((Get-Content "package.json" | ConvertFrom-Json).version) -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name "Publisher" -Value "MailForge" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name "InstallLocation" -Value $InstallDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name "DisplayIcon" -Value $launcher -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name "UninstallString" -Value "powershell.exe -ExecutionPolicy Bypass -File `"$uninstall`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $regPath -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $regPath -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

Write-Host ""
Write-Host "MailForge installed successfully."
Write-Host "Start Menu: MailForge"
Write-Host "Desktop shortcut: $(-not $NoDesktopShortcut)"
Write-Host "Portable data: $(Join-Path $InstallDir 'data\mongodb')"
Write-Host ""
Write-Host "You can pin MailForge from the Start Menu or Desktop shortcut."
