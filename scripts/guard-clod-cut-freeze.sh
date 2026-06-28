#!/usr/bin/env bash
set -euo pipefail

CSV_PATH="${1:-bench-runs/latest/clod-cut-freeze.csv}"
CONFIG_PATH="${2:-assets/config/clod_cut_freeze_guard.toml}"

cargo run --bin clod_cut_freeze_guard -- "$CSV_PATH" --config "$CONFIG_PATH"
