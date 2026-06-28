param(
  [string]$Csv = "bench-runs/local/clod-collider-refresh.csv",
  [string]$Config = "assets/config/clod_collider_refresh_guard.toml"
)
$ErrorActionPreference = "Stop"
cargo run --quiet --bin clod_collider_refresh_guard -- $Csv $Config
