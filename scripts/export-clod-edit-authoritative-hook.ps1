param(
  [string]$InputCsv = "bench-runs/local/clod-edit-mutation-requests.csv",
  [string]$OutputCsv = "bench-runs/local/clod-edit-authoritative-hook.csv"
)

$ErrorActionPreference = "Stop"
cargo run --quiet --bin clod_edit_authoritative_hook_export -- $InputCsv $OutputCsv
