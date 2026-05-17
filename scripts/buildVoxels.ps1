param(
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

if (-not $NoStopExisting) {
    Stop-NamedProcess @("voxel_builder")
}

if (-not $KeepLock -and (Test-Path -LiteralPath $LockPath)) {
    Write-Host "Removing runtime lock $LockPath"
    Remove-Item -LiteralPath $LockPath -Force
}

Set-Location -LiteralPath $RepoRoot
Write-Host "Building user runtime from $RepoRoot"
& rtk cargo build --release
exit $LASTEXITCODE
