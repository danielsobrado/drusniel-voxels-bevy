param(
    [string]$CsvPath = "bench-runs/latest/clod-crossfade-runtime.csv",
    [string]$ConfigPath = "assets/config/clod_crossfade_guard.toml"
)

$ErrorActionPreference = "Stop"

cargo run --bin clod_crossfade_guard -- $CsvPath --config $ConfigPath
