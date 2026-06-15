# Grass Performance Benchmark

Date: 2026-06-15

## Conclusion

Procedural grass blades have a measurable steady-state rendering cost, but they
are not the main cause of the larger frame-time spikes in the tested workload.

In the cleanest adjacent release A/B pair, disabling grass improved median frame
time by 0.51-0.59 ms, or approximately 4.5%, across all three checkpoints. P99
frame time did not improve consistently, so the larger stutters must be caused
by another subsystem.

## Method

The comparison used the same seed, cached world, camera paths, quality preset,
checkpoint durations, and release build. The only intended difference was the
new bench toggle:

```toml
[render_toggles]
quality_preset = "performance100"
disable_grass = true
```

Scenes:

- Grass on: `bench/scenes/visual/visual-regression-performance100.toml`
- Grass off: `bench/scenes/visual/visual-regression-performance100-no-grass.toml`

Commands:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression-performance100.toml --bench-out bench-runs/grass-ab/on-2
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression-performance100-no-grass.toml --bench-out bench-runs/grass-ab/off-2
```

The runs used the DX12 backend on an NVIDIA GeForce RTX 4080.

## Results

Primary adjacent comparison:

| Checkpoint | Grass on median | Grass off median | Improvement | Grass on p99 | Grass off p99 |
|---|---:|---:|---:|---:|---:|
| `ridge-run-noon` | 11.247 ms | 10.736 ms | 0.511 ms / 4.5% | 33.570 ms | 40.845 ms |
| `jump-water-sunset` | 12.125 ms | 11.581 ms | 0.544 ms / 4.5% | 34.835 ms | 34.969 ms |
| `forest-look-sweep` | 12.779 ms | 12.193 ms | 0.586 ms / 4.6% | 34.747 ms | 37.033 ms |

The median improvement is consistent across views. The p99 values are flat or
worse without grass, which rules out grass blades as the source of the measured
long-frame spikes.

## Timing Interpretation

`Grass Collect` averaged only about 0.02-0.03 ms while grass was enabled and
was zero when disabled. Grass generation is therefore not the important
steady-state cost in these checkpoints.

The larger difference appeared in render-thread preparation. Depending on the
view and run, disabling grass reduced rows such as `Render Graph CPU`,
`Render Prepare CPU`, `Render PrepareResources CPU`, and `Render PhaseSort CPU`.
These rows overlap and must not be added together, but their consistent movement
shows that grass primarily costs render preparation and submission work.

The counters confirmed that the A/B switch worked:

- Grass-on runs spawned procedural grass instances and checked grass patches.
- Grass-off runs recorded no grass instance spawning and zero `Grass Collect`
  calls.
- Floating grass particles remained enabled in both runs. This comparison
  isolates procedural terrain blades, not every vegetation-related effect.

## Visual Difference

The screenshots confirm that the grass-off scene removes the green procedural
blade meshes while preserving terrain, water, atmosphere, and the separate prop
system. The visual tradeoff is substantial in nearby terrain coverage despite
the relatively small frame-time improvement.

Representative screenshots:

- Grass on: `bench-runs/grass-ab/on/visual-regression-performance100-ridge-run-noon-mid-run0.png`
- Grass off: `bench-runs/grass-ab/off/visual-regression-performance100-no-grass-ridge-run-noon-mid-run0.png`

## Caveats

The first grass-off run was presentation-limited near 17.3 ms in all three
checkpoints. Its render CPU rows were lower, but its total frame medians were not
usable for the A/B conclusion. Repeating both variants removed that cap; the
second adjacent pair above is the primary comparison.

Each scene currently uses `median_runs = 1`. The consistency across three
checkpoints and repeated runs is enough to establish a small grass cost, but a
higher run count would be required for a precise optimization claim.

The working tree was dirty during measurement, including a pre-existing change
to `assets/shaders/terrain/hextile.wgsl`. These results describe that exact
working-tree state and should not be treated as a clean-commit baseline.

The benchmark guard was run, but its configured checks target
`visual-regression.toml`, so it skipped the performance100 summaries.

## Artifacts

Primary summaries:

- `bench-runs/grass-ab/on-2/summary.json`
- `bench-runs/grass-ab/off-2/summary.json`

Earlier diagnostic runs:

- `bench-runs/grass-ab/on/summary.json`
- `bench-runs/grass-ab/off/summary.json`

Each output directory also contains checkpoint CSV files and staged screenshots.

## Implementation

The repeatable bench switch is implemented in:

- `src/diagnostics/bench/mod.rs`: deserializes `disable_grass` and applies it
  before benchmark startup.
- `src/world/environment/vegetation/mod.rs`: adds `grass_enabled`, defaulting to
  `true`, and skips procedural grass attachment when disabled.
- `bench/scenes/visual/visual-regression-performance100-no-grass.toml`: matched
  no-grass A/B scene.

Normal gameplay behavior is unchanged because `grass_enabled` defaults to
`true`.

## Verification

- `cargo test --lib grass_bench_toggle_deserializes`: passed.
- `cargo fmt -- --check`: passed.
- `git diff --check`: passed.

