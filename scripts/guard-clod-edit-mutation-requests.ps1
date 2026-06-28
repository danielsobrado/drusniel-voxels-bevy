param(
  [string]$Csv = "perf-dumps/clod-edit-mutation-requests.csv",
  [string]$Config = "assets/config/clod_edit_mutation_request_guard.toml"
)

$ErrorActionPreference = "Stop"
cargo run --bin clod_edit_mutation_request_guard -- $Csv $Config
