# CLOD Shadow Bench Guard Thresholds

PR 0013 adds regression-guard inputs for the  CLOD shadow path.

It builds on:

```txt
0008 stable CLOD shadow bench metrics
0009 F3/bench adapters
0010 config/render toggles
0011 runtime wiring
0012 proxy/visual/nocast/off bench presets
0013 guard thresholds
```

## New files

```txt
src/rendering/clod_shadow_bench_guard.rs
assets/config/bench_guard_clod_shadow.toml
docs/rendering/clod-shadow-bench-guard.md
```

The Rust helper evaluates the numeric summary rows emitted by PR 0009/0011.
The TOML file is intentionally separate from the existing `bench_guard.toml` so
it can be reviewed and copied into the active guard config when the bench_guard
binary is wired to the helper.

## Metrics consumed

```txt
Clod Shadow Runtime Mode Code
Clod Shadow Loaded Pages
Clod Shadow Visual Caster Pages
Clod Shadow Proxy Caster Pages
Clod Shadow No Cast Pages
Clod Shadow Missing Visual Entities
Clod Shadow Missing Proxy Meshes
Clod Shadow Visual Triangles
Clod Shadow Runtime Triangles
Clod Shadow Saved Triangles
Clod Shadow Saved Percent
```

Mode codes are the stable values from PR 0011:

```txt
0 disabled
1 proxy
2 visual-only
3 no-cast-only
```

## Default thresholds

```txt
proxy_min_saved_percent = 45.0
proxy_min_proxy_pages = 1
proxy_max_missing_visual_entities = 0
proxy_max_missing_proxy_meshes = 0
visual_max_saved_percent = 5.0
visual_max_proxy_pages = 0
nocast_max_caster_pages = 0
disabled_max_loaded_pages = 0
```

These are deliberately conservative. The proxy path should clearly reduce
terrain shadow triangles, but the first guard should not be so tight that minor
terrain-generation changes fail unrelated PRs.

## Expected checks by bench mode

### `clod-shadow-proxy.toml`

Required:

```txt
saved percent >= proxy_min_saved_percent
proxy caster pages >= proxy_min_proxy_pages
missing visual entities <= 0
missing proxy meshes <= 0
runtime triangles < visual triangles
saved triangles >= 1
```

### `clod-shadow-visual.toml`

Required:

```txt
proxy caster pages <= 0
saved percent <= visual_max_saved_percent
visual caster pages >= 1
```

### `clod-shadow-nocast.toml`

Required:

```txt
visual caster pages + proxy caster pages <= 0
runtime triangles <= 0
```

### `clod-shadow-off.toml`

Required:

```txt
loaded pages <= 0
```

## Usage

Run the four bench presets from PR 0012:

```bash
cargo run --release -- --bench bench/scenes/clod-shadow-proxy.toml
cargo run --release -- --bench bench/scenes/clod-shadow-visual.toml
cargo run --release -- --bench bench/scenes/clod-shadow-nocast.toml
cargo run --release -- --bench bench/scenes/clod-shadow-off.toml
```

Then run the existing guard with the generated summaries once the guard binary
has the CLOD helper wired in:

```bash
cargo run --bin bench_guard -- \
  bench-runs/<proxy-run>/summary.json \
  bench-runs/<visual-run>/summary.json \
  bench-runs/<nocast-run>/summary.json \
  bench-runs/<off-run>/summary.json
```

## Integration hook

The bench_guard side should parse the summary JSON into `BTreeMap<String, f64>`
and call:

```rust,ignore
let report = evaluate_clod_shadow_bench_metrics(
    &metrics,
    &ClodShadowBenchGuardThresholds::default(),
);

if !report.is_pass() {
    for message in report.failure_messages() {
        eprintln!("{message}");
    }
    std::process::exit(1);
}
```

## Acceptance checks

- Proxy mode fails if savings drop below the threshold.
- Proxy mode fails if visual entities or proxy meshes are missing.
- Visual-only mode fails if proxy pages appear.
- No-cast mode fails if any CLOD terrain caster remains.
- Disabled mode fails if the CLOD shadow snapshot remains active.
