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
        "tauri dev",
        "vite",
        "npm run dev:desktop",
        "drusniel-editor-runtime",
        "drusniel_voxels_editor",
        "cargo run"
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

Write-Host "Starting editor from $EditorRoot"
& rtk npm run dev:desktop
exit $LASTEXITCODE
