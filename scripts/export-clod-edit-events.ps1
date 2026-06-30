param(
  [string]$Out = "perf-dumps/clod-edit-events.csv",
  [string]$Scene = "bench/scenes/terrain/clod-edit-stress.toml"
)

$ErrorActionPreference = "Stop"
cargo run --bin clod_edit_events_export -- $Scene --out $Out --require-edits
