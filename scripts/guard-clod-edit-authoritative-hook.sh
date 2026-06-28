#!/usr/bin/env bash
set -euo pipefail

CSV="${1:-perf-dumps/clod-edit-authoritative-hook.csv}"
CONFIG="${2:-assets/config/clod_edit_authoritative_hook_guard.toml}"

cargo run --bin clod_edit_authoritative_hook_guard -- "$CSV" "$CONFIG"
