# Agent Instructions

This repo has an active rendering/performance workflow. Treat profiling as part of the implementation, not as optional cleanup after the fact.

## Profiling Rules

1. Any change that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing should be measured.
2. Use release benches for performance claims:

```powershell
cargo run --release -- --bench bench/scenes/visual-regression.toml
```

3. Benchmark variants already exist for common A/B work:
   - `bench/scenes/visual-regression-high.toml`
   - `bench/scenes/visual-regression-performance100.toml`
   - `bench/scenes/visual-regression-live-lod.toml`
4. Read `bench-runs/<run>/summary.json` and compare before/after numbers. Do not add broad timing rows together because some are parent/child or overlapping brackets.
5. For render investigations, use the built-in counters and timing rows first. If a change claims an improvement, report which rows changed and by how much.
6. Run the regression guard when the change touches known bottlenecks:

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

7. If the change is visual, inspect the fixed checkpoint screenshots from the bench output. Do not accept a performance win that introduces visible regressions unless the tradeoff is intentional and documented.
8. Outside bench mode, `VOXEL_RENDER_TIMING=1` enables the same render timing capture in the debug timing CSV for local diagnosis.

## Expected Workflow

1. Run a baseline bench for the relevant scene.
2. Make the change.
3. Re-run the same bench scene.
4. Compare `summary.json`, screenshots, and any relevant counters.
5. State the measured result plainly, including regressions if they exist.

If you did not profile a performance-sensitive change, say that explicitly instead of implying the result is verified.
