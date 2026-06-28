#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:-perf-dumps/clod-edit-dispatch.csv}"
OUTPUT="${2:-perf-dumps/clod-edit-dry-run.csv}"
INFLUENCE_MARGIN="${3:-}"

if [[ -n "${INFLUENCE_MARGIN}" ]]; then
  cargo run --bin clod_edit_dry_run_export -- "${INPUT}" "${OUTPUT}" "${INFLUENCE_MARGIN}"
else
  cargo run --bin clod_edit_dry_run_export -- "${INPUT}" "${OUTPUT}"
fi
