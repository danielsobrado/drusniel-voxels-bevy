#!/usr/bin/env bash
set -euo pipefail
RUN_DIR=${1:-bench-runs/local}
CONFIG=${2:-assets/config/clod_qa_gate.toml}
cargo run --quiet --bin clod_qa_gate -- "$RUN_DIR" "$CONFIG"
