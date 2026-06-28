param(
    [string]$Out = "perf-dumps/clod-edit-events.csv"
)

cargo run --bin clod_edit_events_export -- `
  bench/scenes/terrain/clod-edit-stress.toml `
  --out $Out `
  --require-edits
