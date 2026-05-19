# NAADF Rendering Backend

Document status: 2026-05-19.  
Implementation status details live in
[`naadf-implementation-status.md`](naadf-implementation-status.md).

NAADF is Drusniel's experimental voxel ray acceleration backend. It builds a
derived GPU cache from the authoritative `VoxelWorld` and uses that cache for
ray queries, preview rendering, and diagnostic far-terrain compositing.

NAADF is not the production renderer. The current renderer remains default and
continues to own terrain meshes, water, props, foliage, NPCs, buildings,
overlays, UI, saves, edits, colliders, and chunk streaming.

## What It Is For

NAADF currently has three practical roles:

- **Path A lighting/ray queries:** optional NAADF-backed visibility, AO,
  contact-shadow, fog/god-ray, and GI query scaffolding while the current
  renderer still draws the scene.
- **Preview rendering:** experimental fullscreen, split-view, and
  picture-in-picture NAADF first-hit preview for debugging the derived voxel
  cache.
- **Path B compositor:** experimental far-terrain/diagnostic compositor that can
  place NAADF terrain behind current raster depth in specific bench/debug modes.

It is useful for research, debugging, and future far-terrain experiments. It is
not yet a production replacement for terrain rendering.

## Safety Model

NAADF is default-off in checked-in configuration:

- the `naadf` Cargo feature must be enabled;
- `assets/config/naadf.yaml` has `enabled: false`;
- Path-B compositor mode defaults to `off`;
- Path-B `foundation_200_210_verified` defaults to `false`;
- Path-B temporal is default-off until ownership-mask history rejection lands.

Fallback is expected behavior. If NAADF is disabled, stale, missing data,
missing resident chunks, blocked by GPU policy, or not ready, the current
renderer/current SDF path should continue to produce output.

## Current Status

Implemented foundation:

- GPU render-graph dispatch for NAADF build/preview paths.
- GPU-built chunk records, mip pyramid, and AADF skip traversal.
- Multi-chunk world traversal.
- Continuous cone-footprint LOD.
- Texture parity for first-hit preview through the shared terrain atlas.
- Startup-stability and preview-only bench coverage.

Implemented experimental paths:

- Path A lighting/ray-query hooks are implemented but remain default-off and are
  not default-promoted.
- Path-B C1 depth-aware compositor is implemented, default-off, and
  foundation-gated. In Path-B modes, first-hit clamps NAADF primary ray distance
  to the raster depth prepass when real scene depth is available, then the
  compositor applies the final depth/coverage reject.
- Path-B DepthAudit mode provides deterministic visual diagnostic overlays.

Still deferred:

- Path-B ownership mask for temporal history rejection.
- Path-B per-pixel GPU debug counter readback.
- Fresh Path A lighting A/B performance promotion evidence.
- Any claim that Path B fixes legacy mesh LOD seams.

## Reference Documents

| For | Doc |
| --- | --- |
| First principles: `VoxelWorld` authoritative, NAADF as derived cache | [`naadf-port-plan.md`](naadf-port-plan.md) |
| Foundation, LOD, and texture detail (`NAADF-200..210`) | [`naadf-distance-lod-plan.md`](naadf-distance-lod-plan.md) |
| Lighting (`NAADF-211..230`) | [`naadf-lighting-plan.md`](naadf-lighting-plan.md) |
| Status of record: done, planned, caveats, and evidence | [`naadf-implementation-status.md`](naadf-implementation-status.md) |
| Ticket breakdown | [`naadf-jira-breakdown.md`](naadf-jira-breakdown.md), [`naadf-implementation-plan.md`](naadf-implementation-plan.md) |
| Risks | [`naadf-risk-register.md`](naadf-risk-register.md) |
| Using, debugging, and benching NAADF | [`naadf.md`](naadf.md), [`naadf-debugging.md`](naadf-debugging.md), [`naadf-benchmarks.md`](naadf-benchmarks.md) |
| Local lights | [`naadf-local-lights-plan.md`](naadf-local-lights-plan.md) |
| Legacy LOD-seam track, separate from NAADF Path B | [`docs/lod/lod-terrain-hole-investigation.md`](../lod/lod-terrain-hole-investigation.md) |

## Enable Manually

Edit `assets/config/naadf.yaml`:

```yaml
enabled: true
```

For the experimental Path-B hybrid compositor:

```yaml
path_b:
  compositor_mode: hybrid_far_terrain
  foundation_200_210_verified: true
  enable_temporal: false
```

For the Path-B diagnostic overlay:

```yaml
path_b:
  compositor_mode: depth_audit
  foundation_200_210_verified: true
  enable_temporal: false
```

Run with the feature:

```powershell
rtk cargo run --release --features naadf
```

Interactive preview keys:

- `F11`: toggle NAADF fullscreen preview.
- `Shift+N`: toggle NAADF split view. A yellow center divider confirms the split
  compositor is active.

Keep `enable_temporal: false` for Path B until ownership-mask history rejection
is implemented.

## Test Commands

Run the focused code checks:

```powershell
rtk cargo test --lib --features naadf rendering::naadf::config::tests::checked_in_config_keeps_naadf_default_off
rtk cargo test --lib --features naadf rendering::naadf::preview
rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl
rtk cargo test --features naadf --test naadf_gpu_layout
rtk cargo test --lib --features naadf bench::tests::naadf_bench_cache_toggles_deserialize
```

Run the visual/runtime benches:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-hybrid.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-depth-audit.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

After each bench, run the guard against the newest summary:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Inspect the PNGs in the same `bench-runs/<run>/` directory:

- preview-only should be textured, not blue silhouette/occupancy-only output;
- Path-B hybrid settled screenshots should preserve current-rendered foreground
  and show NAADF terrain only behind current scene depth;
- Path-B DepthAudit screenshots should show deterministic diagnostic tinting;
- startup-stability staged screenshots should report the first frame/elapsed time
  where the output is fully textured.

## Latest Local Evidence

The most recent recorded verification batch is documented in
[`naadf-implementation-status.md`](naadf-implementation-status.md#naadf-230-path-b-compositor-c1).

Key runs from that batch:

- `bench-runs/2026-05-18T17-58-11Z/summary.json`: preview-only foundation,
  bench guard passed.
- `bench-runs/2026-05-18T18-04-51Z/summary.json`: Path-B hybrid, bench guard
  passed.
- `bench-runs/2026-05-18T18-10-37Z/summary.json`: Path-B DepthAudit, bench
  guard passed.
- `bench-runs/2026-05-18T18-13-07Z/summary.json`: startup stability, bench
  guard passed; frame 120 was already visually textured.

These runs prove the experimental paths can run and pass the current guard
thresholds on the local machine. They do not promote NAADF or Path B to
production defaults.
