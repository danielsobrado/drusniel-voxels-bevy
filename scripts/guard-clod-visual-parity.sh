#!/usr/bin/env bash
set -euo pipefail

selection_csv=${1:-bench-runs/latest/clod-selection-runtime.csv}
crossfade_csv=${2:-bench-runs/latest/clod-crossfade-runtime.csv}
cut_freeze_csv=${3:-bench-runs/latest/clod-cut-freeze.csv}
config=${4:-assets/config/clod_visual_parity_guard.toml}

cargo run --bin clod_visual_parity_guard -- \
  "$selection_csv" \
  "$crossfade_csv" \
  "$cut_freeze_csv" \
  "$config"
