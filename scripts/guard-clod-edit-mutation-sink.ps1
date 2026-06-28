param(
  [string]$Csv = "perf-dumps/clod-edit-mutation-sink.csv",
  [string]$Config = "assets/config/clod_edit_mutation_sink_guard.toml"
)

$ErrorActionPreference = "Stop"
cargo run --bin clod_edit_mutation_sink_guard -- $Csv $Config
