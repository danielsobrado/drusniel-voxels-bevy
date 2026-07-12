# CLOD Shadow Bench Guard Binary

PR 0014 wires the  CLOD shadow guard into the documented benchmark
regression command:

```bash
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

It builds on:

```txt
0008 stable CLOD shadow bench metrics
0009 F3/bench adapters
0010 config/render toggles
0011 runtime wiring
0012 proxy/visual/nocast/off bench presets
0013 threshold evaluator
0014 bench_guard binary/parser integration
```

## New file

```txt
src/bin/bench_guard.rs
```

The binary reads one or more `summary.json` files, extracts numeric metrics, keeps
only keys that start with `Clod Shadow `, and runs the PR 0013 evaluator.

The parser accepts both common summary shapes:

```json
{
  "Clod Shadow Runtime Mode Code": 1,
  "Clod Shadow Saved Percent": 73.0
}
```

and row-style exports:

```json
{
  "summary_values": [
    { "name": "Clod Shadow Runtime Mode Code", "value": 1 },
    { "name": "Clod Shadow Saved Percent", "value": "73.0" }
  ]
}
```

It also records dotted paths for nested numeric leaves, but CLOD shadow checks use
the stable leaf names emitted by PR 0009/0011.

## Config

By default the binary reads:

```txt
assets/config/bench_guard.toml
```

If the file has no `[clod_shadow]` section, defaults from PR 0013 are used. The
section can be copied from `assets/config/bench_guard_clod_shadow.toml`:

```toml
[clod_shadow]
enabled = true
proxy_min_saved_percent = 45.0
proxy_min_proxy_pages = 1
proxy_max_missing_visual_entities = 0
proxy_max_missing_proxy_meshes = 0
visual_max_saved_percent = 5.0
visual_max_proxy_pages = 0
nocast_max_caster_pages = 0
disabled_max_loaded_pages = 0
```

Alternative config path:

```bash
cargo run --bin bench_guard -- \
  --config assets/config/bench_guard_clod_shadow.toml \
  bench-runs/<proxy-run>/summary.json
```

## Recommended A/B run

Run the four presets from PR 0012:

```bash
cargo run --release -- --bench bench/scenes/clod-shadow-proxy.toml
cargo run --release -- --bench bench/scenes/clod-shadow-visual.toml
cargo run --release -- --bench bench/scenes/clod-shadow-nocast.toml
cargo run --release -- --bench bench/scenes/clod-shadow-off.toml
```

Then guard all four summaries:

```bash
cargo run --bin bench_guard -- \
  bench-runs/<proxy-run>/summary.json \
  bench-runs/<visual-run>/summary.json \
  bench-runs/<nocast-run>/summary.json \
  bench-runs/<off-run>/summary.json
```

Expected output:

```txt
[clod-shadow] bench-runs/<proxy-run>/summary.json: PASS mode proxy
[clod-shadow] bench-runs/<visual-run>/summary.json: PASS mode visual-only
[clod-shadow] bench-runs/<nocast-run>/summary.json: PASS mode no-cast-only
[clod-shadow] bench-runs/<off-run>/summary.json: PASS mode disabled
```

## CI behavior

Exit codes:

```txt
0 pass / skipped non-CLOD summaries
1 at least one CLOD shadow guard failure
2 IO, JSON, or TOML parse error
```

By default, summaries without CLOD shadow metrics are skipped so existing visual
bench guards can keep using the same command. Use `--require-clod-shadow` for the
four CLOD-specific scenes when a missing export should be a hard failure.

## Debugging

Print extracted CLOD metrics before evaluation:

```bash
cargo run --bin bench_guard -- \
  --print-clod-shadow-metrics \
  bench-runs/<proxy-run>/summary.json
```

## Acceptance checks

- `cargo run --bin bench_guard -- bench-runs/<proxy-run>/summary.json` fails if
  proxy savings drop below threshold.
- `visual-only` fails if proxy pages are present.
- `no-cast-only` fails if any CLOD terrain caster remains.
- `disabled` fails if a CLOD shadow snapshot is still loaded.
- Non-CLOD summaries skip cleanly unless `--require-clod-shadow` is used.
