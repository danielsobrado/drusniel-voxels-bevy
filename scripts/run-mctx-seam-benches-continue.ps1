# Continue MTX-002 benches after lock cleanup.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Get-Process voxel_builder -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$Runs = @(
    @{ Label = "SN shoreline"; Scene = "bench/scenes/visual/visual-regression-seam-shoreline.toml"; Out = "sn-shoreline"; Mc = $false; Variant = $null },
    @{ Label = "MC replace mountain"; Scene = "bench/scenes/visual/visual-regression-seam-mountain.toml"; Out = "mc-replace-mountain"; Mc = $true; Variant = "mc_transvoxel.replace.yaml" },
    @{ Label = "MC replace overhang-cave"; Scene = "bench/scenes/visual/visual-regression-seam-overhang-cave.toml"; Out = "mc-replace-overhang-cave"; Mc = $true; Variant = "mc_transvoxel.replace.yaml" },
    @{ Label = "MC replace shoreline"; Scene = "bench/scenes/visual/visual-regression-seam-shoreline.toml"; Out = "mc-replace-shoreline"; Mc = $true; Variant = "mc_transvoxel.replace.yaml" },
    @{ Label = "MC sandbox mountain"; Scene = "bench/scenes/visual/visual-regression-seam-mountain.toml"; Out = "mc-sandbox-mountain"; Mc = $true; Variant = "mc_transvoxel.sandbox.yaml" },
    @{ Label = "MC sandbox overhang-cave"; Scene = "bench/scenes/visual/visual-regression-seam-overhang-cave.toml"; Out = "mc-sandbox-overhang-cave"; Mc = $true; Variant = "mc_transvoxel.sandbox.yaml" },
    @{ Label = "MC sandbox shoreline"; Scene = "bench/scenes/visual/visual-regression-seam-shoreline.toml"; Out = "mc-sandbox-shoreline"; Mc = $true; Variant = "mc_transvoxel.sandbox.yaml" }
)

$McConfig = "assets/config/mc_transvoxel.yaml"
$BaselineRoot = "bench-runs/baseline-mctx"
$McBackup = "$BaselineRoot/mc_transvoxel.yaml.bak"

foreach ($run in $Runs) {
    $outDir = Join-Path $BaselineRoot $run.Out
    if (Test-Path (Join-Path $outDir "summary.json")) {
        Write-Host "Skip existing $($run.Label)" -ForegroundColor DarkGray
        continue
    }
    Write-Host "=== $($run.Label) ===" -ForegroundColor Cyan
    Get-Process voxel_builder -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    if ($run.Variant) {
        Copy-Item -Force (Join-Path $BaselineRoot $run.Variant) $McConfig
    } else {
        Copy-Item -Force $McBackup $McConfig
    }
    $featureArgs = @()
    if ($run.Mc) { $featureArgs = @("--features", "mc_transvoxel") }
    & rtk cargo run --release @featureArgs -- --bench $run.Scene --bench-out $outDir --bench-headless
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $($run.Label) exit=$LASTEXITCODE" -ForegroundColor Red
        Get-Process voxel_builder -ErrorAction SilentlyContinue | Stop-Process -Force
        continue
    }
}

Copy-Item -Force $McBackup $McConfig
Write-Host "Mctx bench continuation finished." -ForegroundColor Green
