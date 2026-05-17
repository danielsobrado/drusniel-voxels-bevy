param(
    [switch]$NoStopExisting,
    [switch]$KeepLock
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EditorRoot = Join-Path $RepoRoot "editor\frontend"
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
    Stop-NamedProcess @(
        "drusniel-editor-runtime-x86_64-pc-windows-msvc",
        "drusniel_voxels_editor"
    )
}

if (-not $KeepLock -and (Test-Path -LiteralPath $LockPath)) {
    Write-Host "Removing runtime lock $LockPath"
    Remove-Item -LiteralPath $LockPath -Force
}

Set-Location -LiteralPath $EditorRoot
Write-Host "Building editor runtime sidecar"
& rtk npm run build:runtime
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Building editor desktop app"
& rtk npm run build:desktop
exit $LASTEXITCODE
