#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${1:-bench-runs/clod-full-parity-latest}"
OUT_MD="${2:-$RUN_DIR/clod-qa-report.md}"
OUT_JSON="${3:-$RUN_DIR/clod-qa-report.json}"

cargo run --bin clod_qa_report -- \
  --run-dir "$RUN_DIR" \
  --out-md "$OUT_MD" \
  --out-json "$OUT_JSON"
