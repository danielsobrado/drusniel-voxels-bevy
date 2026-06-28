param(
    [string]$Scene = "bench/scenes/terrain/clod-edit-stress.toml"
)

$ErrorActionPreference = "Stop"

cargo run --bin clod_edit_plan_guard -- --require-edits $Scene

