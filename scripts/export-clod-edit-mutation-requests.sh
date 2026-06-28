#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:-perf-dumps/clod-edit-dry-run.csv}"
OUTPUT="${2:-perf-dumps/clod-edit-mutation-requests.csv}"

cargo run --bin clod_edit_mutation_request_export -- "$INPUT" "$OUTPUT"
