#!/usr/bin/env bash
set -euo pipefail
IN=${1:-bench-runs/local/clod-edit-authoritative-hook.csv}
OUT=${2:-bench-runs/local/clod-collider-refresh.csv}
cargo run --quiet --bin clod_collider_refresh_export -- "$IN" "$OUT"
