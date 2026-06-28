#!/usr/bin/env bash
set -euo pipefail

IN=${1:-bench-runs/local/clod-edit-mutation-requests.csv}
OUT=${2:-bench-runs/local/clod-edit-mutation-sink.csv}

cargo run --quiet --bin clod_edit_mutation_sink_export -- "$IN" "$OUT"
