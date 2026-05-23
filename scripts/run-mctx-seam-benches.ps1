# Surface Nets vs MC+Transvoxel seam scene benches (MTX-002 A/B).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Scenes = @(
    @{ Name = "mountain"; Path = "bench/scenes/visual/visual-regression-seam-mountain.toml" },
    @{ Name = "overhang-cave"; Path = "bench/scenes/visual/visual-regression-seam-overhang-cave.toml" },
    @{ Name = "shoreline"; Path = "bench/scenes/visual/visual-regression-seam-shoreline.toml" }
)

$McConfig = "assets/config/mc_transvoxel.yaml"
$McBackup = "bench-runs/baseline-mctx/mc_transvoxel.yaml.bak"
$BaselineRoot = "bench-runs/baseline-mctx"

New-Item -ItemType Directory -Force -Path $BaselineRoot | Out-Null
Copy-Item -Force $McConfig $McBackup

function Run-Bench {
    param(
        [string]$Label,
        [string]$ScenePath,
        [string]$OutDir,
        [switch]$McFeature,
        [string]$McConfigVariant
    )
    Write-Host "=== $Label -> $OutDir ===" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    if ($McConfigVariant) {
        Copy-Item -Force $McConfigVariant $McConfig
    } else {
        Copy-Item -Force $McBackup $McConfig
    }
    $featureArgs = @()
    if ($McFeature) { $featureArgs = @("--features", "mc_transvoxel") }
    & rtk cargo run --release @featureArgs -- `
        --bench $ScenePath `
        --bench-out $OutDir `
        --bench-headless
    if ($LASTEXITCODE -ne 0) { throw "Bench failed: $Label" }
}

try {
    foreach ($scene in $Scenes) {
        Run-Bench -Label "SN $($scene.Name)" `
            -ScenePath $scene.Path `
            -OutDir "$BaselineRoot/sn-$($scene.Name)"
    }
    foreach ($scene in $Scenes) {
        Run-Bench -Label "MC replace $($scene.Name)" `
            -ScenePath $scene.Path `
            -OutDir "$BaselineRoot/mc-replace-$($scene.Name)" `
            -McFeature `
            -McConfigVariant "$BaselineRoot/mc_transvoxel.replace.yaml"
    }
    foreach ($scene in $Scenes) {
        Run-Bench -Label "MC sandbox $($scene.Name)" `
            -ScenePath $scene.Path `
            -OutDir "$BaselineRoot/mc-sandbox-$($scene.Name)" `
            -McFeature `
            -McConfigVariant "$BaselineRoot/mc_transvoxel.sandbox.yaml"
    }
} finally {
    Copy-Item -Force $McBackup $McConfig
}

Write-Host "Done. Results under $BaselineRoot" -ForegroundColor Green
