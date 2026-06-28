#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: scripts/guard-clod-topology.sh <clod-topology.csv> [config.toml]" >&2
  exit 2
fi

csv="$1"
config="${2:-assets/config/clod_topology_guard.toml}"

if [[ ! -f "$csv" ]]; then
  echo "CLOD topology CSV not found: $csv" >&2
  exit 2
fi

cargo run --bin clod_topology_guard -- "$csv" "$config"
