#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG_PATH="${CLOD_PARITY_TRACKER_CONFIG:-assets/config/clod_parity_tracker.toml}"
OUTPUT_PATH="${1:-${CLOD_PARITY_TRACKER_OUTPUT:-perf-dumps/clod-parity-tracker.md}}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

ARGS=("$CONFIG_PATH" "$OUTPUT_PATH")
if [[ "${CLOD_PARITY_TRACKER_FAIL_ON_MISSING:-0}" == "1" ]]; then
  ARGS+=("--fail-on-missing")
fi
if [[ "${CLOD_PARITY_TRACKER_FAIL_ON_PLANNED:-0}" == "1" ]]; then
  ARGS+=("--fail-on-planned")
fi

cargo run --bin clod_parity_tracker -- "${ARGS[@]}"
echo "[CLOD parity tracker] wrote $OUTPUT_PATH"
