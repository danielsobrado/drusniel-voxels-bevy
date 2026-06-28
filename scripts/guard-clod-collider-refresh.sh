#!/usr/bin/env bash
set -euo pipefail
CSV=${1:-bench-runs/local/clod-collider-refresh.csv}
CONFIG=${2:-assets/config/clod_collider_refresh_guard.toml}
cargo run --quiet --bin clod_collider_refresh_guard -- "$CSV" "$CONFIG"
