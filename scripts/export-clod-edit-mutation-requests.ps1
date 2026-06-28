param(
  [string]$InputCsv = "perf-dumps/clod-edit-dry-run.csv",
  [string]$OutputCsv = "perf-dumps/clod-edit-mutation-requests.csv"
)

$ErrorActionPreference = "Stop"
cargo run --bin clod_edit_mutation_request_export -- $InputCsv $OutputCsv
