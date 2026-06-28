param(
    [string]$Csv = "bench-runs/latest/clod-edit-dry-run.csv",
    [string]$Config = "assets/config/clod_edit_dry_run_guard.toml"
)

cargo run --bin clod_edit_dry_run_guard -- $Csv --config $Config
