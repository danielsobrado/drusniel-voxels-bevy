#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:-perf-dumps/clod-edit-events.csv}"
OUTPUT="${2:-perf-dumps/clod-edit-dispatch.csv}"
MAX_FRAME="${3:-}"

if [[ -n "${MAX_FRAME}" ]]; then
  cargo run --bin clod_edit_dispatch_export -- "${INPUT}" "${OUTPUT}" "${MAX_FRAME}"
else
  cargo run --bin clod_edit_dispatch_export -- "${INPUT}" "${OUTPUT}"
fi
