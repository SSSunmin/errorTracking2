# Stop the Mini-Sentry local stack started by dev-up.ps1.
# Kills node processes belonging to THIS project (spares unrelated projects),
# then stops the Postgres/Redis containers (data is preserved).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev-down.ps1

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

# 1) kill project node processes (vite / tsx watch / npm) by command-line match.
#    Exclude unrelated projects (e.g. vAdvisorRenewal) defensively.
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'claude-codex-test2' -and $_.CommandLine -notmatch 'vAdvisorRenewal' }

if ($procs) {
    Write-Host ("stopping PIDs: " + (($procs.ProcessId) -join ', ')) -ForegroundColor Yellow
    foreach ($p in $procs) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "  stopped $($p.ProcessId)" }
        catch { Write-Host "  could not stop $($p.ProcessId): $($_.Exception.Message)" -ForegroundColor Red }
    }
} else {
    Write-Host "no project node processes running" -ForegroundColor DarkGray
}

# 2) stop infra (keep data; use 'docker compose down' for full removal)
Set-Location $root
docker compose stop postgres redis

# 3) report freed ports
foreach ($port in 4100, 5174, 5176, 5179) {
    $held = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($held) { Write-Host "port $port STILL held by PID $($held.OwningProcess)" -ForegroundColor Red }
    else { Write-Host "port $port free" -ForegroundColor Green }
}
