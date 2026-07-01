# NAADF Rendering Backend

Document status: 2026-07-01.  
Status source of truth: [`naadf-implementation-status.md`](naadf-implementation-status.md).

NAADF is Drusniel's shipped experimental voxel ray-acceleration backend. It is compiled behind the `naadf` feature, builds a derived cache from the authoritative `VoxelWorld`, uploads that cache into GPU buffers, and can run preview, diagnostic compositor, froxel sun-mask, and opt-in lighting-query paths.

NAADF is **not** the default production renderer. The current mesh/PBR renderer still owns normal gameplay rendering: terrain meshes, water, props, foliage, NPCs, buildings, overlays, UI, saves, edits, colliders, and chunk streaming.

## Current Meaning Of "Shipped"

For this repo, **shipped** means:

- Rust/Bevy NAADF systems exist on `main`.
- The plugin registers resources, update systems, render-world extraction, GPU buffers, upload paths, render-graph nodes, and internal WGSL shader assets.
- CPU cache building, dirty tracking, visible-region streaming, CPU tracing, GPU upload packing, preview passes, Path-B diagnostic compositor support, local-light/entity-volume scaffolding, froxel sun-mask integration, and bench/debug counters are present.
- Config and bench scenes exist for reproducible local validation.
- The feature remains default-safe: checked-in runtime config keeps NAADF disabled until explicitly enabled.

**Shipped does not mean default-promoted.** NAADF remains experimental and default-off until release benches prove it should replace or feed production lighting/rendering paths.

## What It Is For Now

NAADF currently has four practical roles:

- **Path A lighting/ray-query backend:** optional NAADF-backed GI-secondary, sun visibility, terrain AO, contact-shadow, fog/god-ray query hooks while the current renderer still draws the scene.
- **Preview rendering:** fullscreen, split-view, and picture-in-picture first-hit preview for debugging the derived voxel cache and traversal.
- **Path B compositor:** default-off far-terrain/diagnostic compositor that can place NAADF terrain behind current raster depth in selected bench/debug modes.
- **Froxel sun-mask support:** default-off NAADF terrain visibility mask for god-ray/fog experiments.

## Safety Model

NAADF is default-off in checked-in configuration:

- `assets/config/naadf.yaml` has `enabled: false`;
- GPU builder preference is off by default;
- integrated GPUs are blocked unless explicitly allowed;
- Path-B compositor mode defaults to `off`;
- Path-B `foundation_200_210_verified` defaults to `false`;
- Path-B temporal is default-off until ownership-mask history rejection is complete;
- Path A production query toggles remain default-off.

Fallback is expected behavior. If NAADF is disabled, stale, missing data, missing resident chunks, blocked by GPU policy, or not ready, the current renderer/current SDF path should continue to produce output.

## Implemented Rust/Bevy Foundation

Implemented foundation:

- Feature-gated `NaadfPlugin` and render-world registration.
- CPU chunk extraction from `VoxelWorld` into derived NAADF cache chunks.
- Dirty derived-cache stream and budgeted cache rebuild.
- Visible-region streaming and eviction with hysteresis.
- CPU ray backend and current-SDF/NAADF comparison tools.
- GPU buffer planning, slot table, upload queue, and budgeted chunk upload.
- Raw voxel, voxel, block, chunk, material, entity-volume, local-light, stats, and scratch resources.
- GPU build shader assets for block/chunk/bounds records.
- WGSL traversal assets for first-hit, world trace, lighting queries, GI trace, debug rays, Path B ownership, temporal/spatial/denoise, and preview compositing.
- Render graph view nodes for NAADF preview/build and froxel sun-mask dispatch.
- Preview render modes, temporal preview history, pass counters, and debug UI/bench counters.
- Static/dynamic voxel proxy scaffolding and local-light upload scaffolding.

Implemented experimental paths:

- Path A lighting query hooks are implemented and opt-in, but remain default-off and not default-promoted.
- Path-B C1 depth-aware compositor is implemented, default-off, and foundation-gated.
- Path-B DepthAudit mode provides deterministic visual diagnostic overlays.
- Froxel sun-mask node is registered before god rays, but the feature remains default-off in config.

Still deferred / not default-promoted:

- Production default use of NAADF for GI, terrain AO, contact shadows, or sun visibility.
- Path-B ownership-mask temporal history rejection.
- Path-B per-pixel GPU debug counter readback.
- Full upstream queue-based chunk propagation parity.
- Full upstream multi-bounce/reference path-tracing parity.
- Claiming Path B fixes legacy mesh LOD seams.

## CLOD PoC Relationship

The browser `tools/clod-poc` NAADF implementation is a shipped validation prototype, not production Rust code. It validates the far-terrain data model, dense/hash/far-summary lookup ideas, heightfield HDDA/AADF-style traversal experiments, GPU far-shell height/material/coverage atlas, far-water overlay, GUI controls, and acceptance scenes.

The CLOD PoC remains intentionally limited:

- heightfield summary approximation, not full Rust 16³ voxel brick occupancy;
- CPU oracle/debug paths still exist;
- HDDA/AADF traversal is a PoC approximation;
- no gameplay collision or Bevy/Rust integration;
- no production path tracing.

Use [`../../tools/clod-poc/docs/naadf-poc.md`](../../tools/clod-poc/docs/naadf-poc.md) for the browser-track status.

## Reference Documents

| For | Doc |
| --- | --- |
| Status of record: done, caveats, benches, and evidence | [`naadf-implementation-status.md`](naadf-implementation-status.md) |
| Original boundary and port map, now updated as implementation record | [`naadf-port-plan.md`](naadf-port-plan.md) |
| Remaining Rust work and Jira-style completion plan | [`naadf-completion-jira-plan.md`](naadf-completion-jira-plan.md) |
| Foundation, LOD, and texture details | [`naadf-distance-lod-plan.md`](naadf-distance-lod-plan.md) |
| Lighting | [`naadf-lighting-plan.md`](naadf-lighting-plan.md) |
| Risks | [`naadf-risk-register.md`](naadf-risk-register.md) |
| Debugging and benchmarks | [`naadf-debugging.md`](naadf-debugging.md), [`naadf-benchmarks.md`](naadf-benchmarks.md) |
| Local lights | [`naadf-local-lights-plan.md`](naadf-local-lights-plan.md) |
| CLOD browser prototype | [`../../tools/clod-poc/docs/naadf-poc.md`](../../tools/clod-poc/docs/naadf-poc.md) |
| Legacy LOD-seam track, separate from NAADF Path B | [`../legacy/lod-terrain-hole-investigation.md`](../legacy/lod-terrain-hole-investigation.md) |

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

Run the default build:

```powershell
rtk cargo run --release
```

Interactive preview keys:

- `F11`: cycle runtime voxel backend state.
- `Shift+N`: toggle NAADF split view. A yellow center divider confirms the split compositor is active.

Keep `enable_temporal: false` for Path B until ownership-mask history rejection is implemented.

## Test Commands

Run the focused code checks:

```powershell
rtk cargo test --lib rendering::naadf::config::tests::checked_in_config_keeps_naadf_default_off
rtk cargo test --lib rendering::naadf::preview
rtk cargo test --lib rendering::naadf::layout::tests::wgsl
rtk cargo test --test naadf_gpu_layout
rtk cargo test --lib bench::tests::naadf_bench_cache_toggles_deserialize
```

Run the visual/runtime benches:

```powershell
rtk cargo run --release -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --release -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-hybrid.toml
rtk cargo run --release -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-depth-audit.toml
rtk cargo run --release -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

After each bench, run the guard against the newest summary:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Inspect the PNGs in the same `bench-runs/<run>/` directory:

- preview-only should be textured, not blue silhouette/occupancy-only output;
- Path-B hybrid settled screenshots should preserve current-rendered foreground and show NAADF terrain only behind current scene depth;
- Path-B DepthAudit screenshots should show deterministic diagnostic tinting;
- startup-stability staged screenshots should report the first frame/elapsed time where the output is fully textured.

## Latest Recorded Evidence

The most recent checked-in status file records the 2026-05-18/2026-05-19 verification batch. Key runs from that batch:

- `bench-runs/2026-05-18T17-58-11Z/summary.json`: preview-only foundation, bench guard passed.
- `bench-runs/2026-05-18T18-04-51Z/summary.json`: Path-B hybrid, bench guard passed.
- `bench-runs/2026-05-18T18-10-37Z/summary.json`: Path-B DepthAudit, bench guard passed.
- `bench-runs/2026-05-18T18-13-07Z/summary.json`: startup stability, bench guard passed; frame 120 was already visually textured.

These runs prove the experimental paths can run and pass the current guard thresholds on the local machine. They do not promote NAADF or Path B to production defaults.
