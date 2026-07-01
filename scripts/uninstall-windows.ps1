param(
    [switch]$KeepData
)

$ErrorActionPreference = "Stop"
$InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "Uninstalling MailForge from $InstallDir"

$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\MailForge"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "MailForge.lnk"

Remove-Item -LiteralPath $startMenuDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MailForge" -Recurse -Force -ErrorAction SilentlyContinue

if ($KeepData) {
    Write-Host "Keeping app data at $InstallDir\data"
    Get-ChildItem -LiteralPath $InstallDir -Force |
        Where-Object { $_.Name -ne "data" } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "MailForge removed."
