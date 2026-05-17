# Profiling

Document status (2026-05-17): historical release/reference record; keep for versioned context, not current implementation instructions.

* **F3**: Show the in-game 60-frame CPU area timing table.
* **F4**: Dump the current timing window as CSV to `perf-dumps/frame-<UTC>.csv`, including `__frame_total`.
* **Tracy**: Run `cargo run --release --features tracy`, then connect with Tracy 0.11.x.

### Benchmarking

```powershell
cargo run --release -- --bench bench/scenes/visual/default.toml
cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
cargo run --release -- --bench bench/scenes/collider/gameplay-movement-smoke.toml
```

Output: 

`bench-runs/<timestamp>/summary.json` plus per-checkpoint CSV files and screenshots.
`visual-regression.toml` runs deterministic camera movement paths for run, jump, and look-sweep coverage, with named screenshots captured at fixed frames for visual comparison.


`gameplay-movement-smoke.toml` is the deterministic end-to-end movement smoke test. Unlike the visual bench, it opts into physics/player systems, drives scripted movement through the normal action/input path, and records `Bench Gameplay Horizontal Speed`, `Bench Gameplay Stall Frames`, `Bench Gameplay Stall Events`, and `Bench Gameplay Failed` so terrain collider or live LOD movement regressions are visible in `summary.json` and CSV output.


Bench runs also enable render timing rows for Bevy render stages, render-graph CPU/GPU pass diagnostics, shadow passes, post-processing, and window texture acquisition. Outside bench mode, set `VOXEL_RENDER_TIMING=1` to capture the same render timing rows in the debug timing CSV.


Before a checkpoint starts moving, the bench now waits for both terrain readiness and a render-ready signature made from stable phase item, prop queue, terrain, water, and reflection counters. The console prints `[BENCH READY]` first, then `[BENCH RENDER READY]` when the fully drawn frame is stable enough to begin measurement.


Bench scenes can also set `[render_toggles]` for A/B diagnosis only: `disable_instanced_props`, `disable_water_meshes`, `disable_buildings`, `disable_shadows`, `disable_reflection_cameras`, `force_instanced_props_transparent`, `force_cutout_props_alpha_mask`, `force_instanced_props_opaque`, `disable_prop_lod_hiding`, `disable_prop_shadow_lod`, `terrain_material_quality`, `disable_terrain_material_lod`, `prop_subcluster_grid`, and `quality_preset`. Terrain material quality accepts `auto`, `full_triplanar`, `cheap_triplanar`, `single_projection_far`, or `atlas_only_debug`; `prop_subcluster_grid` accepts `0`, `2`, or `4`; `quality_preset` accepts `low`, `medium`, `high`, or `performance100`. 

`Performance100` keeps near-field terrain on the High path while tightening prop LOD/shadow distances, switching far terrain material earlier, and lowering nearby water reflection cost. For example, `bench/scenes/forest/forest-ab-disable-instanced-props.toml` runs the forest look sweep with prop instancing removed from the render queue.

`bench/scenes/visual/visual-regression-performance100.toml` runs the deterministic visual paths with the 100 FPS performance preset enabled.

`bench/scenes/visual/visual-regression-high.toml` pins the same paths to the High preset for direct A/B comparison.


`bench/scenes/visual/visual-regression-live-lod.toml` runs the same visual paths with `freeze_terrain_lod_after_ready = false` to profile live terrain LOD behavior during camera motion.

Run the regression guard after a visual bench to catch known render bottlenecks:

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Thresholds live in `assets/config/bench_guard.toml` and can be copied or tuned per machine/GPU. The guard is a bench/regression command only; it is not part of normal `cargo build` or `cargo check`.
Pass both the visual bench and direct-water summaries when validating water reflection behavior:

```powershell
cargo run --bin bench_guard -- bench-runs/<visual-run>/summary.json bench-runs/<direct-water-run>/summary.json
```


