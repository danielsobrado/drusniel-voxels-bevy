param(
  [string]$InputCsv = "bench-runs/local/clod-edit-mutation-requests.csv",
  [string]$OutputCsv = "bench-runs/local/clod-edit-mutation-sink.csv"
)

$ErrorActionPreference = "Stop"
cargo run --quiet --bin clod_edit_mutation_sink_export -- $InputCsv $OutputCsv
