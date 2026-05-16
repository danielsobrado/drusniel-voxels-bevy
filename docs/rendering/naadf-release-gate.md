# NAADF Release Gate

NAADF remains disabled by default until this evidence is present for the current change set.

## Required Evidence

- CPU/GPU record parity passes:
  - `rtk cargo test --features naadf rendering::naadf::gpu_tests --lib`
  - `rtk cargo test --features naadf --test naadf_gpu_layout`
- Non-empty preview screenshots from:
  - `bench/scenes/visual-regression-naadf-preview.toml`
  - `bench/scenes/visual-regression-naadf-gi.toml`
  - `bench/scenes/visual-regression-naadf-live-lod.toml`
- Startup visual stability measured with:
  - `rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-startup-stability.toml`
  - Report the first staged screenshot `frame` and `elapsed_secs` from `summary.json` that is fully textured, not the blue silhouette/early occupancy preview.
- The current renderer remains the default path when NAADF flags are not set.
- Integrated-GPU fallback remains disabled by default and reports a fallback reason instead of allocating NAADF buffers.
- `bench_guard` passes on the NAADF summary files:
  - `rtk cargo run --bin bench_guard -- <summary.json> ...`
- Known regressions are listed with the exact scene, checkpoint, metric, and screenshot.

## Bench Scenes

- `visual-regression-naadf-current.toml`: current renderer baseline.
- `visual-regression-naadf-preview.toml`: NAADF preview output after extended settling.
- `visual-regression-naadf-gi.toml`: current renderer with NAADF GI path after extended settling.
- `visual-regression-naadf-live-lod.toml`: moving-camera NAADF stability path after extended settling.
- `visual-regression-naadf-startup-stability.toml`: staged startup screenshots for initial visual stability timing, including `settle-120`, `settle-240`, `settle-360`, `settle-540`, `settle-720`, `settle-899`, `settle-1200`, and `settle-1499`.
- `dig-edit-naadf-stability.toml`: cache/edit stability path.

## Report Format

For each run, include the scene, summary path, checkpoint frame times, key NAADF counters, and inspected screenshot names. Do not claim release readiness if screenshots were captured before NAADF preview textures settled.
