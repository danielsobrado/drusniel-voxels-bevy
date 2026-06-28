#!/usr/bin/env bash
set -euo pipefail

CSV="${1:-perf-dumps/clod-edit-mutation-sink.csv}"
CONFIG="${2:-assets/config/clod_edit_mutation_sink_guard.toml}"

cargo run --bin clod_edit_mutation_sink_guard -- "$CSV" "$CONFIG"
