param(
    [string]$Plan = "perf-dumps/clod-edit-plan.csv",
    [string]$Rebuild = "perf-dumps/clod-rebuild-observer.csv"
)

cargo run --bin clod_edit_rebuild_guard -- `
  --plan $Plan `
  --rebuild $Rebuild
