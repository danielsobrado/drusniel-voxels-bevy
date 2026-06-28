param(
  [string]$Csv = "perf-dumps/clod-edit-authoritative-hook.csv",
  [string]$Config = "assets/config/clod_edit_authoritative_hook_guard.toml"
)

$ErrorActionPreference = "Stop"
cargo run --bin clod_edit_authoritative_hook_guard -- $Csv $Config
