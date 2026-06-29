#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${CLOD_QA_RUN_DIR:-bench-runs/local}"
FAST="${VOXEL_CLOD_QA_FAST:-0}"
mkdir -p "$RUN_DIR"

CLOD_QA_RUN_DIR="$RUN_DIR" scripts/run-clod-complete-qa.sh
scripts/report-clod-qa.sh "$RUN_DIR"

if [[ "$FAST" == "1" ]]; then
  echo "[CLOD FINAL QA] skipped final artifact gate because VOXEL_CLOD_QA_FAST=1"
else
  scripts/guard-clod-qa-gate.sh "$RUN_DIR"
fi

echo "[CLOD FINAL QA] OK: $RUN_DIR"
