param(
  [string]$RunDir = "bench-runs/local",
  [string]$Config = "assets/config/clod_apply_mode_guard.toml"
)
$ErrorActionPreference = "Stop"
cargo run --quiet --bin clod_apply_mode_guard -- $RunDir $Config
