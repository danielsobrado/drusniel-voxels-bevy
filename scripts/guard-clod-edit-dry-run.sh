#!/usr/bin/env bash
set -euo pipefail

CSV="${1:-bench-runs/latest/clod-edit-dry-run.csv}"
CONFIG="${2:-assets/config/clod_edit_dry_run_guard.toml}"

cargo run --bin clod_edit_dry_run_guard -- "$CSV" --config "$CONFIG"
