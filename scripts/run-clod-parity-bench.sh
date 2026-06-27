#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${RUN_DIR:-bench-runs/clod-parity/latest}"
SCENE="${SCENE:-bench/scenes/terrain/clod-parity-stress.toml}"
PROFILE="${PROFILE:-release}"
SKIP_BENCH="${SKIP_BENCH:-0}"
SKIP_GUARDS="${SKIP_GUARDS:-0}"

STATS_CSV="$RUN_DIR/clod-selection-runtime.csv"
REBUILD_CSV="$RUN_DIR/clod-rebuild-observer.csv"

step() {
  printf '\n==> %s\n' "$1"
}

mkdir -p "$RUN_DIR"

if [[ "$SKIP_BENCH" != "1" ]]; then
  rm -f "$STATS_CSV" "$REBUILD_CSV"

  export CLOD_PAGES=1
  export VOXEL_CLOD_STATS_CSV=1
  export VOXEL_CLOD_STATS_CSV_PATH="$STATS_CSV"
  export VOXEL_CLOD_REBUILD_CSV=1
  export VOXEL_CLOD_REBUILD_CSV_PATH="$REBUILD_CSV"

  step "CLOD parity bench"
  if [[ "$PROFILE" == "release" ]]; then
    cargo run --release -- --bench "$SCENE"
  else
    cargo run -- --bench "$SCENE"
  fi
fi

if [[ ! -f "$STATS_CSV" ]]; then
  echo "missing CLOD selection CSV: $STATS_CSV" >&2
  exit 2
fi

if [[ ! -f "$REBUILD_CSV" ]]; then
  echo "missing CLOD rebuild CSV: $REBUILD_CSV" >&2
  exit 2
fi

if [[ "$SKIP_GUARDS" != "1" ]]; then
  step "CLOD selection guard"
  cargo run --bin clod_stats_guard -- "$STATS_CSV"

  step "CLOD rebuild guard"
  cargo run --bin clod_rebuild_guard -- "$REBUILD_CSV"
fi

cat <<EOF

CLOD parity artifacts:
  selection CSV: $STATS_CSV
  rebuild CSV:   $REBUILD_CSV
EOF

