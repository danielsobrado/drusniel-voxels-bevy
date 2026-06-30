param(
  [string]$InputCsv = "perf-dumps/clod-edit-events.csv",
  [string]$OutputCsv = "perf-dumps/clod-edit-dispatch.csv",
  [string]$MaxFrame = ""
)

$ErrorActionPreference = "Stop"
if ($MaxFrame) {
  cargo run --bin clod_edit_dispatch_export -- $InputCsv $OutputCsv $MaxFrame
} else {
  cargo run --bin clod_edit_dispatch_export -- $InputCsv $OutputCsv
}
