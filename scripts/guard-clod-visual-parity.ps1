param(
    [string]$SelectionCsv = "bench-runs/latest/clod-selection-runtime.csv",
    [string]$CrossfadeCsv = "bench-runs/latest/clod-crossfade-runtime.csv",
    [string]$CutFreezeCsv = "bench-runs/latest/clod-cut-freeze.csv",
    [string]$Config = "assets/config/clod_visual_parity_guard.toml"
)

$ErrorActionPreference = "Stop"

cargo run --bin clod_visual_parity_guard -- `
    $SelectionCsv `
    $CrossfadeCsv `
    $CutFreezeCsv `
    $Config
