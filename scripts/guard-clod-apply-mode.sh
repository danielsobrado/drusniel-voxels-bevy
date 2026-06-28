#!/usr/bin/env bash
set -euo pipefail
RUN_DIR=${1:-bench-runs/local}
CONFIG=${2:-assets/config/clod_apply_mode_guard.toml}
cargo run --quiet --bin clod_apply_mode_guard -- "$RUN_DIR" "$CONFIG"
