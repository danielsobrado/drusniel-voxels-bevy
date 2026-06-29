#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-perf-dumps/clod-edit-plan.csv}"
shift || true

cargo run --bin clod_edit_plan_export -- \
  bench/scenes/terrain/clod-edit-stress.toml \
  --out "$OUT" \
  --require-edits \
  "$@"
