param(
    [switch]$Naadf,
    [switch]$NoStopExisting,
    [switch]$KeepLock
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockPath = Join-Path ([System.IO.Path]::GetTempPath()) "drusniel-voxels\runtime.lock"

function Stop-NamedProcess {
    param([string[]]$Names)

    foreach ($name in $Names) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "Stopping $($_.ProcessName) pid=$($_.Id)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Stop-RepoProcess {
    param([string[]]$Markers)

    $escapedRepo = [Regex]::Escape($RepoRoot)
    Get-CimInstance Win32_Process |
        Where-Object {
            $cmd = $_.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmd)) {
                return $false
            }
            if ($cmd -notmatch $escapedRepo) {
                return $false
            }
            foreach ($marker in $Markers) {
                if ($cmd -like "*$marker*") {
                    return $true
                }
            }
            return $false
        } |
        ForEach-Object {
            Write-Host "Stopping repo process $($_.Name) pid=$($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

if (-not $NoStopExisting) {
    Stop-NamedProcess @(
        "voxel_builder",
        "drusniel-editor-runtime-x86_64-pc-windows-msvc",
        "drusniel_voxels_editor"
    )
    Stop-RepoProcess @(
        "cargo run",
        "voxel_builder",
        "drusniel-editor-runtime",
        "drusniel_voxels_editor"
    )
}

if (-not $KeepLock -and (Test-Path -LiteralPath $LockPath)) {
    Write-Host "Removing runtime lock $LockPath"
    Remove-Item -LiteralPath $LockPath -Force
}

Set-Location -LiteralPath $RepoRoot
$cargoArgs = @("cargo", "run", "--release")
if ($Naadf) {
    $env:DRUSNIEL_NAADF = "1"
    $cargoArgs += @("--features", "naadf")
    Write-Host "Starting user runtime from $RepoRoot with NAADF feature enabled"
} else {
    Remove-Item Env:\DRUSNIEL_NAADF -ErrorAction SilentlyContinue
    Write-Host "Starting user runtime from $RepoRoot"
}

& rtk @cargoArgs
exit $LASTEXITCODE
