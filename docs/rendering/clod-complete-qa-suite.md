# CLOD complete QA suite

`run-clod-complete-qa.*` is the final wrapper for the CLOD parity patch stack.
It keeps the older full parity suite intact and adds a stricter, all-artifact
run that mirrors the PoC idea of treating CLOD as a measured pipeline rather
than a screenshot-only feature.

## What it runs

1. Validate the scripted edit-plan TOML schema.
2. Export expected dirty CLOD nodes from the edit plan.
3. Run the live-LOD CLOD bench with every telemetry exporter enabled.
4. Run all standalone guards.
5. Generate `clod-qa-report.md` and `clod-qa-report.json`.

## Artifacts

The run directory defaults to:

```text
bench-runs/clod-complete-<UTC timestamp>/
```

It contains:

```text
clod-edit-plan.csv
clod-selection-runtime.csv
clod-rebuild-observer.csv
clod-crossfade-runtime.csv
clod-cut-freeze.csv
clod-border-locks.csv
clod-topology.csv
clod-simplify.csv
clod-weld.csv
clod-qa-report.md
clod-qa-report.json
README.md
```

## Run

Linux/macOS:

```bash
scripts/run-clod-complete-qa.sh
```

Windows PowerShell:

```powershell
scripts/run-clod-complete-qa.ps1
```

## Useful overrides

```bash
CLOD_PARITY_RUN_DIR=bench-runs/my-run
CLOD_PARITY_PLAN_SCENE=bench/scenes/terrain/clod-edit-stress.toml
CLOD_PARITY_BENCH_SCENE=bench/scenes/terrain/clod-parity-stress.toml
```

The edit-plan-vs-rebuild guard remains default-off until the bench runtime
executes `[[checkpoint.clod_edit]]` operations:

```bash
VOXEL_CLOD_RUN_EDIT_REBUILD_GUARD=1 scripts/run-clod-complete-qa.sh
```

## Why this is separate from the older full suite

`run-clod-full-parity-suite.*` landed earlier while only selection, rebuild and
crossfade telemetry existed. Later PRs added cut-freeze, border-lock, topology,
simplification, weld and aggregate reporting. This wrapper avoids risky churn in
the older script and gives CI/review a complete CLOD parity entry point.
