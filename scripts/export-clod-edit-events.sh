#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-perf-dumps/clod-edit-events.csv}"
shift || true

cargo run --bin clod_edit_events_export -- \
  bench/scenes/terrain/clod-edit-stress.toml \
  --out "$OUT" \
  --require-edits \
  "$@"
