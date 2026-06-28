#!/usr/bin/env bash
set -euo pipefail

csv=${1:-bench-runs/latest/clod-border-locks.csv}
config=${2:-assets/config/clod_border_lock_guard.toml}

cargo run --bin clod_border_lock_guard -- "$csv" "$config"
