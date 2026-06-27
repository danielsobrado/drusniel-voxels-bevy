#!/usr/bin/env bash
set -euo pipefail

# Run the CLOD shadow A/B benchmark matrix and validate the resulting summaries.
#
# This script intentionally keeps the same public commands documented by the
# project:
#   cargo run --release -- --bench bench/scenes/<scene>.toml
#   cargo run --bin bench_guard -- bench-runs/<run>/summary.json
#
# Usage:
#   scripts/run_clod_shadow_bench_matrix.sh
#   scripts/run_clod_shadow_bench_matrix.sh --profile debug
#   scripts/run_clod_shadow_bench_matrix.sh --guard-only bench-runs/*/summary.json
#   scripts/run_clod_shadow_bench_matrix.sh --print-metrics

PROFILE="release"
CONFIG="assets/config/bench_guard.toml"
REQUIRE_CLOD_SHADOW=1
PRINT_METRICS=0
RUN_BENCHES=1
SUMMARY_ARGS=()

usage() {
  cat <<'USAGE'
Run CLOD shadow bench presets and validate them with bench_guard.

Options:
  --profile <release|debug>       Cargo profile for bench runs. Default: release.
  --config <path>                 bench_guard config path. Default: assets/config/bench_guard.toml.
  --guard-only <summary...>       Skip bench runs and guard the supplied summary files.
  --allow-missing-clod-shadow     Do not pass --require-clod-shadow to bench_guard.
  --print-metrics                 Print extracted CLOD shadow metrics in bench_guard.
  -h, --help                      Show this help.

Examples:
  scripts/run_clod_shadow_bench_matrix.sh
  scripts/run_clod_shadow_bench_matrix.sh --guard-only bench-runs/*/summary.json
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --config)
      CONFIG="${2:-}"
      shift 2
      ;;
    --guard-only)
      RUN_BENCHES=0
      shift
      while [[ $# -gt 0 && "$1" != --* ]]; do
        SUMMARY_ARGS+=("$1")
        shift
      done
      ;;
    --allow-missing-clod-shadow)
      REQUIRE_CLOD_SHADOW=0
      shift
      ;;
    --print-metrics)
      PRINT_METRICS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$PROFILE" != "release" && "$PROFILE" != "debug" ]]; then
  echo "--profile must be release or debug" >&2
  exit 2
fi

run_cargo_bench() {
  local scene="$1"
  if [[ "$PROFILE" == "release" ]]; then
    cargo run --release -- --bench "$scene"
  else
    cargo run -- --bench "$scene"
  fi
}

SCENES=(
  "bench/scenes/clod-shadow-proxy.toml"
  "bench/scenes/clod-shadow-visual.toml"
  "bench/scenes/clod-shadow-nocast.toml"
  "bench/scenes/clod-shadow-off.toml"
)

BENCH_GUARD_ARGS=("--config" "$CONFIG")
if [[ "$REQUIRE_CLOD_SHADOW" == "1" ]]; then
  BENCH_GUARD_ARGS+=("--require-clod-shadow")
fi
if [[ "$PRINT_METRICS" == "1" ]]; then
  BENCH_GUARD_ARGS+=("--print-clod-shadow-metrics")
fi

if [[ "$RUN_BENCHES" == "1" ]]; then
  marker="$(mktemp)"
  trap 'rm -f "$marker"' EXIT

  for scene in "${SCENES[@]}"; do
    echo "[clod-shadow-bench] running $scene"
    run_cargo_bench "$scene"
  done

  mapfile -t SUMMARY_ARGS < <(find bench-runs -type f -name summary.json -newer "$marker" | sort)
fi

if [[ "${#SUMMARY_ARGS[@]}" -eq 0 ]]; then
  echo "no summary.json files found for CLOD shadow bench guard" >&2
  exit 1
fi

echo "[clod-shadow-bench] guarding ${#SUMMARY_ARGS[@]} summary file(s)"
cargo run --bin bench_guard -- "${BENCH_GUARD_ARGS[@]}" "${SUMMARY_ARGS[@]}"
