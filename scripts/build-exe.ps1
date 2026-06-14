# Build MailForge.exe using built-in Windows C# compiler (no extra installs)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location $Root

$csc64 = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$csc32 = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
$csc = if (Test-Path $csc64) { $csc64 } elseif (Test-Path $csc32) { $csc32 } else { $null }

if (-not $csc) {
    throw "csc.exe not found. Install .NET Framework 4.x Developer Pack or use Start-MailForge.bat"
}

$source = Join-Path $ScriptDir "MailForgeLauncher.cs"
$output = Join-Path $Root "MailForge.exe"

if (-not (Test-Path $source)) {
    throw "Missing scripts/MailForgeLauncher.cs"
}

Write-Host "Compiling MailForge.exe ..."
& $csc /nologo /target:exe /out:$output $source

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $output)) {
    throw "Compile failed"
}

Write-Host "SUCCESS: $output"
Write-Host "Double-click MailForge.exe (Docker Desktop must be running for persistent DB)."
