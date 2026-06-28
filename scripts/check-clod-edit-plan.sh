#!/usr/bin/env bash
set -euo pipefail

SCENE="${1:-bench/scenes/terrain/clod-edit-stress.toml}"

cargo run --bin clod_edit_plan_guard -- --require-edits "$SCENE"

