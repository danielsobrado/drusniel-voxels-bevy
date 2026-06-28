#!/usr/bin/env bash
set -euo pipefail
RUN_DIR=${CLOD_QA_RUN_DIR:-bench-runs/local}
mkdir -p "$RUN_DIR"

if [[ -x scripts/run-clod-complete-qa.sh ]]; then
  CLOD_QA_RUN_DIR="$RUN_DIR" scripts/run-clod-complete-qa.sh
fi

scripts/export-clod-collider-refresh.sh \
  "$RUN_DIR/clod-edit-authoritative-hook.csv" \
  "$RUN_DIR/clod-collider-refresh.csv"
scripts/guard-clod-collider-refresh.sh "$RUN_DIR/clod-collider-refresh.csv"
scripts/guard-clod-apply-mode.sh "$RUN_DIR"

if [[ -x scripts/report-clod-qa.sh ]]; then
  scripts/report-clod-qa.sh "$RUN_DIR"
fi
if [[ -x scripts/guard-clod-qa-gate.sh ]]; then
  scripts/guard-clod-qa-gate.sh "$RUN_DIR"
fi

echo "[CLOD FINAL QA] OK: $RUN_DIR"
