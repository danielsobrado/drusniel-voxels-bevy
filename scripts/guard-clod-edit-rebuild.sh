#!/usr/bin/env bash
set -euo pipefail

PLAN="${1:-perf-dumps/clod-edit-plan.csv}"
REBUILD="${2:-perf-dumps/clod-rebuild-observer.csv}"
shift 2 2>/dev/null || true

cargo run --bin clod_edit_rebuild_guard -- \
  --plan "$PLAN" \
  --rebuild "$REBUILD" \
  "$@"
