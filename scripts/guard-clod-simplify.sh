#!/usr/bin/env bash
set -euo pipefail

CSV_PATH="${1:-}"
CONFIG_PATH="${2:-assets/config/clod_simplify_guard.toml}"

if [[ -z "${CSV_PATH}" ]]; then
  echo "usage: scripts/guard-clod-simplify.sh <clod-simplify.csv> [config.toml]" >&2
  exit 2
fi

if [[ ! -f "${CSV_PATH}" ]]; then
  echo "CLOD simplify CSV not found: ${CSV_PATH}" >&2
  exit 2
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "CLOD simplify guard config not found: ${CONFIG_PATH}" >&2
  exit 2
fi

cargo run --bin clod_simplify_guard -- \
  --config "${CONFIG_PATH}" \
  "${CSV_PATH}"
