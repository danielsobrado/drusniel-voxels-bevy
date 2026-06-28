param([string]$CsvPath = "bench-runs/latest/clod-weld.csv")
$ErrorActionPreference = "Stop"
cargo run --bin clod_weld_guard -- $CsvPath
