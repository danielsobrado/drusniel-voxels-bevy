# CLOD Crossfade Guard

`clod_crossfade_guard` validates the CSV emitted by
`VOXEL_CLOD_CROSSFADE_STATS_CSV=1`.

It is intended for deterministic live-LOD benches after the PoC-style CLOD
crossfade bridge and dither material path are enabled.

## Run

```bash
CLOD_PAGES=1 \
VOXEL_CLOD_CROSSFADE_BRIDGE=1 \
VOXEL_CLOD_CROSSFADE_MATERIAL=1 \
VOXEL_CLOD_CROSSFADE_STATS_CSV=1 \
VOXEL_CLOD_CROSSFADE_STATS_CSV_PATH=bench-runs/<run>/clod-crossfade-runtime.csv \
cargo run --release -- --bench bench/scenes/visual/visual-regression-live-lod.toml

cargo run --bin clod_crossfade_guard -- bench-runs/<run>/clod-crossfade-runtime.csv
```

Or use the wrappers:

```bash
scripts/guard-clod-crossfade.sh bench-runs/<run>/clod-crossfade-runtime.csv
```

```powershell
scripts/guard-clod-crossfade.ps1 bench-runs/<run>/clod-crossfade-runtime.csv
```

## What it catches

- CLOD crossfade material path accidentally disabled in a bench.
- Fade-in/fade-out transitions that never move alpha.
- Fade-out pages or fade-out entities still present at the final sample.
- Runtime fade state without ECS fade entities.
- Broken role counters where stable/fade-in/fade-out no longer sum to all faded entities.
- Invalid alpha ranges outside `[0, 1]`.

## Configuration

Thresholds live in `assets/config/clod_crossfade_guard.toml`.

For generic benches, keep `min_transitions_observed = 0`. For a dedicated
crossfade/live-LOD route, raise it to at least `1` so the guard fails if the
camera path never actually triggers a CLOD cut transition.
