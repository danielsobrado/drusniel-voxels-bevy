#!/usr/bin/env bash
set -euo pipefail

CSV="${1:-perf-dumps/clod-edit-mutation-requests.csv}"
CONFIG="${2:-assets/config/clod_edit_mutation_request_guard.toml}"

cargo run --bin clod_edit_mutation_request_guard -- "$CSV" "$CONFIG"
