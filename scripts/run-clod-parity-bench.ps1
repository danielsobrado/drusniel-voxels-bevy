param(
    [string]$RunDir = "bench-runs/clod-parity/latest",
    [string]$Scene = "bench/scenes/terrain/clod-parity-stress.toml",
    [switch]$Release = $true,
    [switch]$SkipBench,
    [switch]$SkipGuards
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host "`n==> $Name" -ForegroundColor Cyan
    & $Command
}

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

$statsCsv = Join-Path $RunDir "clod-selection-runtime.csv"
$rebuildCsv = Join-Path $RunDir "clod-rebuild-observer.csv"

if (-not $SkipBench) {
    Remove-Item -Force -ErrorAction SilentlyContinue $statsCsv, $rebuildCsv

    $env:CLOD_PAGES = "1"
    $env:VOXEL_CLOD_STATS_CSV = "1"
    $env:VOXEL_CLOD_STATS_CSV_PATH = $statsCsv
    $env:VOXEL_CLOD_REBUILD_CSV = "1"
    $env:VOXEL_CLOD_REBUILD_CSV_PATH = $rebuildCsv

    $cargoArgs = @("run")
    if ($Release) {
        $cargoArgs += "--release"
    }
    $cargoArgs += @("--", "--bench", $Scene)

    Invoke-Step "CLOD parity bench" {
        cargo @cargoArgs
    }
}

if (-not (Test-Path $statsCsv)) {
    throw "missing CLOD selection CSV: $statsCsv"
}

if (-not (Test-Path $rebuildCsv)) {
    throw "missing CLOD rebuild CSV: $rebuildCsv"
}

if (-not $SkipGuards) {
    Invoke-Step "CLOD selection guard" {
        cargo run --bin clod_stats_guard -- $statsCsv
    }

    Invoke-Step "CLOD rebuild guard" {
        cargo run --bin clod_rebuild_guard -- $rebuildCsv
    }
}

Write-Host "`nCLOD parity artifacts:" -ForegroundColor Green
Write-Host "  selection CSV: $statsCsv"
Write-Host "  rebuild CSV:   $rebuildCsv"

