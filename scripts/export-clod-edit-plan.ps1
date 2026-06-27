param(
    [string]$Out = "perf-dumps/clod-edit-plan.csv"
)

cargo run --bin clod_edit_plan_export -- `
  bench/scenes/terrain/clod-edit-stress.toml `
  --out $Out `
  --require-edits
