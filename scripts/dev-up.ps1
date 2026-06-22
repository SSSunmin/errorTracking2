# Launch the full Mini-Sentry local stack as background processes.
# Each long-running dev server opens in its own PowerShell window so you can see logs.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev-up.ps1
# See docs/LOCAL-STACK.md for the service/port reference.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # repo root (scripts/..)
Write-Host "repo root: $root" -ForegroundColor Cyan

function Wait-For {
    param([string]$Label, [scriptblock]$Test, [int]$TimeoutSec = 90)
    Write-Host "waiting for $Label ..." -NoNewline
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        try { if (& $Test) { Write-Host " OK" -ForegroundColor Green; return $true } } catch {}
        Start-Sleep -Seconds 1; Write-Host "." -NoNewline
    }
    Write-Host " TIMEOUT" -ForegroundColor Red; return $false
}

function Start-Svc {
    param([string]$Title, [string]$Cmd)
    $inner = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$root'; Write-Host '> $Cmd' -ForegroundColor Yellow; $Cmd"
    Start-Process powershell -ArgumentList '-NoExit', '-Command', $inner | Out-Null
    Write-Host "launched: $Title" -ForegroundColor Green
}

# 0) Docker daemon
$dockerOk = $false
try { docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0) } catch {}
if (-not $dockerOk) {
    Write-Host "Docker daemon down -> starting Docker Desktop" -ForegroundColor Yellow
    $dd = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dd) { Start-Process $dd }
    Wait-For 'docker daemon' { docker info *> $null; $LASTEXITCODE -eq 0 } 180 | Out-Null
}

# 1+2) Infra (start if containers exist, else create)
Set-Location $root
docker compose start postgres redis 2>$null
if ($LASTEXITCODE -ne 0) { docker compose up -d postgres redis }
Wait-For 'postgres' { (docker exec claude-codex-test2-postgres-1 pg_isready -U mini_sentry) -match 'accepting' } 60 | Out-Null
Wait-For 'redis'    { (docker exec claude-codex-test2-redis-1 redis-cli ping) -match 'PONG' } 30 | Out-Null

# 3) API server (gate the rest on /health)
Start-Svc 'mini-sentry: API (4100)' 'npm run dev -w @mini-sentry/server'
Wait-For 'API /health' { (Invoke-RestMethod -Uri 'http://localhost:4100/health' -TimeoutSec 2).status -eq 'ok' } 90 | Out-Null

# 4-7) independent services
Start-Svc 'mini-sentry: worker'        'npm run worker:dev -w @mini-sentry/server'
Start-Svc 'mini-sentry: dashboard (5176)' 'npm run dev -w @mini-sentry/dashboard -- --port 5176 --strictPort'
Start-Svc 'mini-sentry: html-demo (5179)' 'npm run dev -w @mini-sentry/demo-app -- --port 5179 --strictPort'
Start-Svc 'mini-sentry: react-sample (5174)' 'npm --prefix .tools/react-sample run dev -- --port 5174 --strictPort'

Write-Host ""
Write-Host "Stack up:" -ForegroundColor Cyan
Write-Host "  dashboard    http://localhost:5176"
Write-Host "  react-sample http://localhost:5174"
Write-Host "  html-demo    http://localhost:5179"
Write-Host "  API          http://localhost:4100/health"
Write-Host "Teardown: scripts\dev-down.ps1" -ForegroundColor DarkGray
