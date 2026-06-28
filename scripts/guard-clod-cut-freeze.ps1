param(
    [string]$CsvPath = "bench-runs/latest/clod-cut-freeze.csv",
    [string]$ConfigPath = "assets/config/clod_cut_freeze_guard.toml"
)

$ErrorActionPreference = "Stop"

cargo run --bin clod_cut_freeze_guard -- $CsvPath --config $ConfigPath
