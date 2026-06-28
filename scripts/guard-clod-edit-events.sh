#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CSV="${1:-bench-runs/latest/clod-edit-events.csv}"
CONFIG="${2:-${CLOD_EDIT_EVENTS_GUARD_CONFIG:-assets/config/clod_edit_events_guard.toml}}"

cargo run --bin clod_edit_events_guard -- "$CSV" --config "$CONFIG"
