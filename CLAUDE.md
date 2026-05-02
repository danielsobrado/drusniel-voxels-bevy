# Claude Instructions

Keep profiling in the loop as features are added. Rendering work in this repo is performance-sensitive, and unmeasured changes are not enough.

## Performance Expectations

- Use `cargo run --release -- --bench ...` for any change that could affect frame time, render passes, terrain meshing, props, water, shadows, or post effects.
- Prefer the deterministic visual bench scenes so runs are comparable:
  - `bench/scenes/visual-regression.toml`
  - `bench/scenes/visual-regression-high.toml`
  - `bench/scenes/visual-regression-performance100.toml`
  - `bench/scenes/visual-regression-live-lod.toml`
- Compare the generated `bench-runs/<run>/summary.json` before and after the change.
- Do not sum broad timing rows such as Render Graph, Render Prepare, QueueMeshes, or nested prepare brackets. Treat them as separate symptoms.
- Use the fixed screenshot checkpoints from the bench output to check visual stability.

## Regression Guard

Use the bench guard for bottleneck checks:

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Thresholds live in `assets/config/bench_guard.toml`. Tune thresholds per machine only when needed, and document that choice.

## Reporting

When you claim a perf improvement, include:

1. The bench scene used.
2. The before/after numbers from `summary.json`.
3. The main counters or timing rows that moved.
4. Any visual tradeoff or ready-state issue discovered during the run.

If a change was not benchmarked, say so directly.
