param(
  [string]$InputCsv = "perf-dumps/clod-edit-dispatch.csv",
  [string]$OutputCsv = "perf-dumps/clod-edit-dry-run.csv",
  [string]$InfluenceMargin = ""
)

$ErrorActionPreference = "Stop"

if ($InfluenceMargin -ne "") {
  cargo run --bin clod_edit_dry_run_export -- $InputCsv $OutputCsv $InfluenceMargin
} else {
  cargo run --bin clod_edit_dry_run_export -- $InputCsv $OutputCsv
}
