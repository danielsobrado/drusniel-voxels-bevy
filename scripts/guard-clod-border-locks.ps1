param(
    [string]$Csv = "bench-runs/latest/clod-border-locks.csv",
    [string]$Config = "assets/config/clod_border_lock_guard.toml"
)

$ErrorActionPreference = "Stop"

cargo run --bin clod_border_lock_guard -- $Csv $Config
