# Export MailForge MongoDB data to ./backups/ (requires Docker Mongo running)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupDir = Join-Path (Join-Path $Root "..") "backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Out = Join-Path $BackupDir "mailforge-$Stamp"

New-Item -ItemType Directory -Force -Path $Out | Out-Null

$running = docker inspect --format='{{.State.Running}}' mailforge-mongo 2>$null
if ($running -ne 'true') {
    Write-Error "mailforge-mongo container is not running. Start it with: npm run mongo:up"
}

docker exec mailforge-mongo mongodump --db=mailforge --out=/tmp/backup
docker cp "mailforge-mongo:/tmp/backup/mailforge" $Out
docker exec mailforge-mongo rm -rf /tmp/backup

Write-Host "Backup saved to $Out"
Write-Host "Restore: docker exec -i mailforge-mongo mongorestore --db=mailforge --drop /data/restore/mailforge"
