# CLOD Shadow Bench Workflow

PR 0015 makes the  CLOD shadow regression check repeatable without
forcing expensive GPU-like benches on every push.

It builds on:

```txt
0012 bench scene presets
0013 CLOD shadow thresholds
0014 bench_guard summary parser/binary
```

## Local matrix command

Run all four CLOD shadow presets and guard their newly generated summaries:

```bash
scripts/run_clod_shadow_bench_matrix.sh
```

The script runs:

```bash
cargo run --release -- --bench bench/scenes/clod-shadow-proxy.toml
cargo run --release -- --bench bench/scenes/clod-shadow-visual.toml
cargo run --release -- --bench bench/scenes/clod-shadow-nocast.toml
cargo run --release -- --bench bench/scenes/clod-shadow-off.toml
```

Then it calls:

```bash
cargo run --bin bench_guard -- \
  --config assets/config/bench_guard.toml \
  --require-clod-shadow \
  bench-runs/<new-run>/summary.json ...
```

## Guard existing summaries only

Use this after copying bench output from another machine:

```bash
scripts/run_clod_shadow_bench_matrix.sh \
  --guard-only bench-runs/*/summary.json
```

Print extracted CLOD shadow metrics:

```bash
scripts/run_clod_shadow_bench_matrix.sh \
  --guard-only bench-runs/*/summary.json \
  --print-metrics
```

## Debug profile

For smoke checks where absolute performance is not meaningful:

```bash
scripts/run_clod_shadow_bench_matrix.sh --profile debug
```

Use release mode for performance comparisons and regression thresholds.

## GitHub Actions workflow

New workflow:

```txt
.github/workflows/clod-shadow-bench.yml
```

The workflow is `workflow_dispatch` only. It does not run on every push because
bench scenes can be slow and may vary by runner/GPU availability.

Manual modes:

```txt
run_benches=false  guard existing bench-runs/*/summary.json committed or restored in the workspace
run_benches=true   run the four CLOD shadow scenes, then guard the generated summaries
```

Artifacts:

```txt
bench-runs/** -> clod-shadow-bench-runs
```

## Expected pass modes

```txt
proxy     must save shadow triangles and have zero missing mappings
visual    must not use proxy pages
nocast    must leave no CLOD shadow casters
off       must not load CLOD shadow pages
```

## Why manual first

This is intentionally conservative. The CLOD shadow path is render/performance
sensitive, and hosted CI machines are not a stable proxy for local GPU benches.
The workflow still gives maintainers a one-click regression job once a suitable
runner is available.
