param(
  [string]$Out = "perf-dumps/clod-edit-plan.csv",
  [string]$Scene = "bench/scenes/terrain/clod-edit-stress.toml"
)

$ErrorActionPreference = "Stop"
cargo run --bin clod_edit_plan_export -- $Scene --out $Out --require-edits
