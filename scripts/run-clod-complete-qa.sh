#!/usr/bin/env bash
set -euo pipefail

# Complete CLOD parity QA runner.
#
# This exports every scripted-edit artifact, runs the runtime CLOD telemetry
# bench unless VOXEL_CLOD_QA_FAST=1 is set, guards the produced CSVs, and writes
# the aggregate Markdown/JSON report.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${CLOD_PARITY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_DIR="${CLOD_QA_RUN_DIR:-${CLOD_PARITY_RUN_DIR:-bench-runs/clod-complete-${RUN_ID}}}"
PLAN_SCENE="${CLOD_PARITY_PLAN_SCENE:-bench/scenes/terrain/clod-edit-stress.toml}"
BENCH_SCENE="${CLOD_PARITY_BENCH_SCENE:-bench/scenes/terrain/clod-parity-stress.toml}"
PROFILE="${CLOD_QA_PROFILE:-release}"
FAST="${VOXEL_CLOD_QA_FAST:-0}"

PLAN_CSV="$RUN_DIR/clod-edit-plan.csv"
EVENTS_CSV="$RUN_DIR/clod-edit-events.csv"
DISPATCH_CSV="$RUN_DIR/clod-edit-dispatch.csv"
DRY_RUN_CSV="$RUN_DIR/clod-edit-dry-run.csv"
MUTATION_REQUESTS_CSV="$RUN_DIR/clod-edit-mutation-requests.csv"
MUTATION_SINK_CSV="$RUN_DIR/clod-edit-mutation-sink.csv"
AUTHORITATIVE_HOOK_CSV="$RUN_DIR/clod-edit-authoritative-hook.csv"
SELECTION_CSV="$RUN_DIR/clod-selection-runtime.csv"
REBUILD_CSV="$RUN_DIR/clod-rebuild-observer.csv"
CROSSFADE_CSV="$RUN_DIR/clod-crossfade-runtime.csv"
CUT_FREEZE_CSV="$RUN_DIR/clod-cut-freeze.csv"
BORDER_LOCK_CSV="$RUN_DIR/clod-border-locks.csv"
TOPOLOGY_CSV="$RUN_DIR/clod-topology.csv"
SIMPLIFY_CSV="$RUN_DIR/clod-simplify.csv"
WELD_CSV="$RUN_DIR/clod-weld.csv"
COLLIDER_REFRESH_CSV="$RUN_DIR/clod-collider-refresh.csv"

step() {
  printf '\n[CLOD complete QA] %s\n' "$1"
}

require_artifact() {
  local path="$1"
  if [[ ! -s "$path" ]]; then
    printf '[CLOD complete QA] missing or empty artifact: %s\n' "$path" >&2
    exit 2
  fi
}

mkdir -p "$RUN_DIR"

step "run dir: $RUN_DIR"
step "validating edit plan schema: $PLAN_SCENE"
cargo run --bin clod_edit_plan_guard -- --require-edits "$PLAN_SCENE"

step "exporting edit plan: $PLAN_CSV"
cargo run --bin clod_edit_plan_export -- "$PLAN_SCENE" --out "$PLAN_CSV" --require-edits

step "exporting scripted edit events: $EVENTS_CSV"
cargo run --bin clod_edit_events_export -- "$PLAN_SCENE" --out "$EVENTS_CSV" --require-edits

step "exporting scripted edit dispatch: $DISPATCH_CSV"
bash scripts/export-clod-edit-dispatch.sh "$EVENTS_CSV" "$DISPATCH_CSV"

step "exporting dry-run edit audit: $DRY_RUN_CSV"
bash scripts/export-clod-edit-dry-run.sh "$DISPATCH_CSV" "$DRY_RUN_CSV"

step "exporting mutation requests: $MUTATION_REQUESTS_CSV"
bash scripts/export-clod-edit-mutation-requests.sh "$DRY_RUN_CSV" "$MUTATION_REQUESTS_CSV"

step "exporting mutation sink audit: $MUTATION_SINK_CSV"
bash scripts/export-clod-edit-mutation-sink.sh "$MUTATION_REQUESTS_CSV" "$MUTATION_SINK_CSV"

step "exporting authoritative hook audit: $AUTHORITATIVE_HOOK_CSV"
bash scripts/export-clod-edit-authoritative-hook.sh "$MUTATION_REQUESTS_CSV" "$AUTHORITATIVE_HOOK_CSV"

step "exporting collider refresh audit: $COLLIDER_REFRESH_CSV"
bash scripts/export-clod-collider-refresh.sh "$AUTHORITATIVE_HOOK_CSV" "$COLLIDER_REFRESH_CSV"

for artifact in \
  "$PLAN_CSV" \
  "$EVENTS_CSV" \
  "$DISPATCH_CSV" \
  "$DRY_RUN_CSV" \
  "$MUTATION_REQUESTS_CSV" \
  "$MUTATION_SINK_CSV" \
  "$AUTHORITATIVE_HOOK_CSV" \
  "$COLLIDER_REFRESH_CSV"; do
  require_artifact "$artifact"
done

step "guarding scripted edit events"
bash scripts/guard-clod-edit-events.sh "$EVENTS_CSV"

step "guarding dry-run edit audit"
bash scripts/guard-clod-edit-dry-run.sh "$DRY_RUN_CSV"

step "guarding mutation requests"
bash scripts/guard-clod-edit-mutation-requests.sh "$MUTATION_REQUESTS_CSV"

step "guarding mutation sink audit"
bash scripts/guard-clod-edit-mutation-sink.sh "$MUTATION_SINK_CSV"

step "guarding authoritative hook audit"
bash scripts/guard-clod-edit-authoritative-hook.sh "$AUTHORITATIVE_HOOK_CSV"

step "guarding collider refresh audit"
bash scripts/guard-clod-collider-refresh.sh "$COLLIDER_REFRESH_CSV"

step "guarding apply mode"
bash scripts/guard-clod-apply-mode.sh "$RUN_DIR"

if [[ "$FAST" == "1" ]]; then
  step "skipping runtime bench and runtime guards because VOXEL_CLOD_QA_FAST=1"
else
  rm -f \
    "$SELECTION_CSV" \
    "$REBUILD_CSV" \
    "$CROSSFADE_CSV" \
    "$CUT_FREEZE_CSV" \
    "$BORDER_LOCK_CSV" \
    "$TOPOLOGY_CSV" \
    "$SIMPLIFY_CSV" \
    "$WELD_CSV"

  export CLOD_PAGES=1
  export VOXEL_CLOD_STATS_CSV=1
  export VOXEL_CLOD_STATS_CSV_PATH="$SELECTION_CSV"
  export VOXEL_CLOD_REBUILD_CSV=1
  export VOXEL_CLOD_REBUILD_CSV_PATH="$REBUILD_CSV"
  export VOXEL_CLOD_CROSSFADE_BRIDGE=1
  export VOXEL_CLOD_CROSSFADE_MATERIAL=1
  export VOXEL_CLOD_CROSSFADE_STATS_CSV=1
  export VOXEL_CLOD_CROSSFADE_STATS_CSV_PATH="$CROSSFADE_CSV"
  export VOXEL_CLOD_CUT_FREEZE_CSV=1
  export VOXEL_CLOD_CUT_FREEZE_CSV_PATH="$CUT_FREEZE_CSV"
  export VOXEL_CLOD_BORDER_LOCK_CSV=1
  export VOXEL_CLOD_BORDER_LOCK_CSV_PATH="$BORDER_LOCK_CSV"
  export VOXEL_CLOD_TOPOLOGY_CSV=1
  export VOXEL_CLOD_TOPOLOGY_CSV_PATH="$TOPOLOGY_CSV"
  export VOXEL_CLOD_SIMPLIFY_CSV=1
  export VOXEL_CLOD_SIMPLIFY_CSV_PATH="$SIMPLIFY_CSV"
  export VOXEL_CLOD_WELD_CSV=1
  export VOXEL_CLOD_WELD_CSV_PATH="$WELD_CSV"

  step "running runtime CLOD bench: $BENCH_SCENE"
  if [[ "$PROFILE" == "release" ]]; then
    cargo run --release -- --bench "$BENCH_SCENE"
  else
    cargo run -- --bench "$BENCH_SCENE"
  fi

  for artifact in \
    "$SELECTION_CSV" \
    "$REBUILD_CSV" \
    "$CROSSFADE_CSV" \
    "$CUT_FREEZE_CSV" \
    "$BORDER_LOCK_CSV" \
    "$TOPOLOGY_CSV" \
    "$SIMPLIFY_CSV" \
    "$WELD_CSV"; do
    require_artifact "$artifact"
  done

  step "guarding selection stats"
  cargo run --bin clod_stats_guard -- "$SELECTION_CSV" --config "${CLOD_STATS_GUARD_CONFIG:-assets/config/clod_stats_guard.toml}"

  step "guarding rebuild stats"
  cargo run --bin clod_rebuild_guard -- "$REBUILD_CSV" --config "${CLOD_REBUILD_GUARD_CONFIG:-assets/config/clod_rebuild_guard.toml}"

  step "guarding crossfade stats"
  bash scripts/guard-clod-crossfade.sh "$CROSSFADE_CSV"

  step "guarding cut-freeze stats"
  bash scripts/guard-clod-cut-freeze.sh "$CUT_FREEZE_CSV"

  step "guarding visual parity integration"
  bash scripts/guard-clod-visual-parity.sh "$SELECTION_CSV" "$CROSSFADE_CSV" "$CUT_FREEZE_CSV"

  step "guarding border locks"
  bash scripts/guard-clod-border-locks.sh "$BORDER_LOCK_CSV"

  step "guarding topology"
  bash scripts/guard-clod-topology.sh "$TOPOLOGY_CSV"

  step "guarding simplification"
  bash scripts/guard-clod-simplify.sh "$SIMPLIFY_CSV"

  step "guarding welds"
  bash scripts/guard-clod-welds.sh "$WELD_CSV"

  if [[ "${VOXEL_CLOD_RUN_EDIT_REBUILD_GUARD:-0}" == "1" ]]; then
    step "guarding edit plan against rebuild telemetry"
    bash scripts/guard-clod-edit-rebuild.sh "$PLAN_CSV" "$REBUILD_CSV"
  else
    step "skipping edit-vs-rebuild guard; set VOXEL_CLOD_RUN_EDIT_REBUILD_GUARD=1 after scripted edit execution is wired"
  fi
fi

step "writing aggregate report"
bash scripts/report-clod-qa.sh "$RUN_DIR"

cat > "$RUN_DIR/README.md" <<EOF_README
# CLOD complete QA run ${RUN_ID}

Generated by \`scripts/run-clod-complete-qa.sh\`.

## Inputs

- plan scene: \`${PLAN_SCENE}\`
- bench scene: \`${BENCH_SCENE}\`
- fast mode: \`${FAST}\`

## Scripted edit artifacts

- \`clod-edit-plan.csv\`
- \`clod-edit-events.csv\`
- \`clod-edit-dispatch.csv\`
- \`clod-edit-dry-run.csv\`
- \`clod-edit-mutation-requests.csv\`
- \`clod-edit-mutation-sink.csv\`
- \`clod-edit-authoritative-hook.csv\`
- \`clod-collider-refresh.csv\`
- \`clod-qa-report.md\`
- \`clod-qa-report.json\`

## Runtime artifacts

These are generated only when \`VOXEL_CLOD_QA_FAST\` is not \`1\`:

- \`clod-selection-runtime.csv\`
- \`clod-rebuild-observer.csv\`
- \`clod-crossfade-runtime.csv\`
- \`clod-cut-freeze.csv\`
- \`clod-border-locks.csv\`
- \`clod-topology.csv\`
- \`clod-simplify.csv\`
- \`clod-weld.csv\`

Real authoritative terrain mutation remains pending. The scripted edit artifacts
prove dry-run planning, mutation requests, sink readiness, authoritative-hook
readiness, and collider-refresh audit coverage.
EOF_README

step "complete: $RUN_DIR"
