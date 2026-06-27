# CLOD full parity suite

`scripts/run-clod-full-parity-suite.*` is the single-command QA wrapper for the
CLOD parity patches.

It mirrors the PoC direction of treating CLOD as a measured runtime pipeline,
not just as visual output. The suite produces the same classes of artifacts that
are needed for review:

- expected dirty-node plan from the scripted edit-plan TOML;
- selection/runtime CSV;
- rebuild observer CSV;
- crossfade/dither CSV;
- guard pass/fail output.

## Run

Linux/macOS:

```bash
scripts/run-clod-full-parity-suite.sh
```

Windows PowerShell:

```powershell
scripts/run-clod-full-parity-suite.ps1
```

By default the run directory is:

```text
bench-runs/clod-parity-<UTC timestamp>/
```

Override it with:

```bash
CLOD_PARITY_RUN_DIR=bench-runs/my-clod-run scripts/run-clod-full-parity-suite.sh
```

## Default scenes

The suite separates the edit-plan contract from the live-LOD bench:

```text
CLOD_PARITY_PLAN_SCENE=bench/scenes/terrain/clod-edit-stress.toml
CLOD_PARITY_BENCH_SCENE=bench/scenes/terrain/clod-parity-stress.toml
```

This is intentional. `clod-edit-stress.toml` declares expected edit dirtiness,
but scripted edit execution is not wired into the bench runtime yet. The suite
therefore validates and exports the edit plan, while the runtime bench uses the
safe live-LOD CLOD scene.

## Guards run by default

- `clod_stats_guard`
- `clod_rebuild_guard`
- `clod_crossfade_guard`

The edit-plan-vs-rebuild guard is available but default-off:

```bash
VOXEL_CLOD_RUN_EDIT_REBUILD_GUARD=1 scripts/run-clod-full-parity-suite.sh
```

Enable it only after the bench runtime actually executes `[[checkpoint.clod_edit]]`
operations; otherwise the guard is expected to fail because no runtime edit has
occurred.

## Useful overrides

```bash
CLOD_PARITY_PLAN_SCENE=bench/scenes/terrain/clod-edit-stress.toml
CLOD_PARITY_BENCH_SCENE=bench/scenes/visual/visual-regression-live-lod.toml
CLOD_STATS_GUARD_CONFIG=assets/config/clod_stats_guard.toml
CLOD_REBUILD_GUARD_CONFIG=assets/config/clod_rebuild_guard.toml
CLOD_CROSSFADE_GUARD_CONFIG=assets/config/clod_crossfade_guard.toml
```
