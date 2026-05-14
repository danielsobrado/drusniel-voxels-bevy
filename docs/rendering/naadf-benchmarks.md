# NAADF Benchmarks

NAADF performance work should use release benches and fixed scenes. Do not claim a performance improvement from debug builds.

## Scene Set

Current reference:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-current.toml
```

GI experiment:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
```

Preview experiment:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-preview.toml
```

Live LOD stress:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-live-lod.toml
```

Heavy edit stress:

```bash
rtk cargo run --release --features naadf -- --bench bench/scenes/dig-edit-naadf-stability.toml
```

## A/B Workflow

1. Run `visual-regression-naadf-current.toml` as the current-backend baseline.
2. Run the matching NAADF scene.
3. Compare `bench-runs/<run>/summary.json` files.
4. Inspect fixed checkpoint screenshots for visible regressions.
5. Run `bench_guard` with the relevant summaries.

Example guard invocation:

```bash
rtk cargo run --bin bench_guard -- \
  bench-runs/<current-run>/summary.json \
  bench-runs/<naadf-run>/summary.json
```

The `[naadf]` block in `assets/config/bench_guard.toml` expands into optional checks for:

- GPU memory bytes.
- Dirty chunks pending.
- Oldest queued build age.
- Uploaded chunks per frame.
- Average ray steps.
- GI/preview frame-time regression against the current reference run.

NAADF checks skip when the matching NAADF summary is not provided, so existing non-NAADF guard runs continue to work.

## Baseline Readiness

Before accepting a visual or performance claim, create fresh baseline runs for:

- `visual-regression-naadf-current.toml`
- `visual-regression-naadf-gi.toml`
- `visual-regression-naadf-preview.toml`
- `visual-regression-naadf-live-lod.toml`
- `dig-edit-naadf-stability.toml`

Record the run ids, frame averages, p99s, NAADF counters, and screenshot inspection notes in the implementation status or release notes.

No NAADF visual baselines have been generated for the current implementation batch yet.
