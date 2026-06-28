#!/usr/bin/env bash
set -euo pipefail
CSV_PATH="${1:-bench-runs/latest/clod-weld.csv}"
cargo run --bin clod_weld_guard -- "${CSV_PATH}"
