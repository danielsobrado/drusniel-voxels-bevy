param(
  [string]$InputCsv = "bench-runs/local/clod-edit-authoritative-hook.csv",
  [string]$OutputCsv = "bench-runs/local/clod-collider-refresh.csv"
)
$ErrorActionPreference = "Stop"
cargo run --quiet --bin clod_collider_refresh_export -- $InputCsv $OutputCsv
