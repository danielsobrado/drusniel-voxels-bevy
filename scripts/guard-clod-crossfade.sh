#!/usr/bin/env bash
set -euo pipefail

CSV_PATH="${1:-bench-runs/latest/clod-crossfade-runtime.csv}"
CONFIG_PATH="${2:-assets/config/clod_crossfade_guard.toml}"

cargo run --bin clod_crossfade_guard -- "$CSV_PATH" --config "$CONFIG_PATH"
