# NAADF-230 Path-B Compositor Plan

Status: planned, default-off, feature-gated (`naadf`), experimental.  
Last updated: 2026-05-18  
Related: `naadf-lighting-plan.md`, `naadf-distance-lod-plan.md`,
`naadf-implementation-status.md`, `naadf-upstream-parity.md`,
`naadf-completion-jira-plan.md`.

This document defines `NAADF-230`: an optional hybrid primary / far-terrain
compositor. It is **not** a renderer replacement. It reuses the existing NAADF
preview pipeline where possible, adds a depth-buffer handshake with the current
renderer, and keeps Path A lighting independent.

## Non-Negotiables

- `VoxelWorld` remains authoritative for terrain, edits, saves, colliders, chunk
  streaming, and mesh generation.
- The current renderer remains default and production-owned.
- Path B is behind the `naadf` feature and a default-off runtime/config mode.
- Path A lighting (`NAADF-211..218`) does not depend on Path B.
- Existing rastered geometry stays in front: water, props, foliage, NPCs,
  buildings, editor overlays, and UI are not replaced by NAADF.
- NAADF must never panic or hard-take-over on missing buffers, missing resident
  chunks, stale cache, or allocation failure. It falls back to current output.

## Path-B V1 Behavior

Path-B v1 composites NAADF terrain behind the current scene:

1. Current renderer produces scene color and depth.
2. NAADF first-hit traces terrain from the active camera using the existing
   GPU cache, mip traversal, texture atlas, fog, lighting hooks, and preview
   history/filter passes where enabled.
3. The compositor compares current raster depth and NAADF hit depth in
   **linear view depth**. Do not compare raw device-depth values directly.
4. Current scene color wins when raster depth is in front of the NAADF hit.
5. NAADF color is allowed only where raster depth is absent, sky/far clear, or
   farther than the NAADF terrain hit.
6. Misses, stale chunks, unresident chunks, and missing-fine-mip primary hits
   preserve the current renderer output unless a diagnostic audit mode is active.

Path-B v1 is useful for optional preview, editor/debug screenshots, and far
terrain experiments. It is not a final renderer parity target.

## Modes

### `DebugPreview`

Existing NAADF preview behavior. Fullscreen, split-view, and picture-in-picture
preview modes remain available for debugging. This mode may show NAADF terrain
over the current scene because its purpose is comparison.

### `HybridFarTerrain`

Current renderer foreground plus NAADF terrain behind raster depth. This is the
main Path-B compositor mode. It must preserve current-renderer foreground
geometry and should be visually quiet when NAADF misses or falls back.

### `DepthAudit`

Diagnostic mode for validation screenshots. It visualizes:

- raster-depth rejects;
- NAADF accepts;
- NAADF misses;
- stale or unresident chunks;
- missing-fine-mip refine requests.

Audit colors must be deterministic and suitable for fixed-frame bench
inspection. This mode is debug-only and must not be used for visual parity
claims.

## Data Flow

Inputs:

- current scene color;
- current scene depth;
- camera projection/view data needed to reconstruct linear view depth;
- NAADF first-hit color/depth/normal/motion outputs;
- optional NAADF temporal/spatial/denoise outputs;
- NAADF cache, chunk lookup, terrain atlas, local-light records, and stats
  buffers already used by the preview pipeline.

Pass order:

1. Current renderer writes scene color/depth as usual.
2. NAADF build/upload passes update the GPU cache if preview/Path-B is active.
3. NAADF first-hit writes hit color, normalized hit depth, normal, motion, and
   diagnostic reason.
4. Optional GI, temporal, spatial, denoise, and reference passes run exactly as
   they do for preview, gated by existing preview settings.
5. Path-B compositor reads current color/depth and the selected NAADF color/depth
   source, applies depth ownership, and writes the final view target.

Implementation should prefer the existing `preview_fullscreen_composite.wgsl`
and `pipeline.rs` render-node path. Do not resurrect the older preview
composite path unless there is a specific bind-layout reason.

## Public Surface

Add the minimum public/config surface needed to select and measure Path B:

```rust
pub enum NaadfPathBCompositorMode {
    Off,
    DebugPreview,
    HybridFarTerrain,
    DepthAudit,
}
```

Config/runtime concepts:

- `path_b_compositor_mode`, default `Off`;
- `path_b_depth_epsilon`, default small positive linear-depth tolerance;
- `path_b_enable_temporal`, default uses existing preview temporal setting;
- `path_b_audit_overlay_alpha`, used only by `DepthAudit`;
- bench toggle for Path-B compositor mode.

Stats/counters:

- `naadf.path_b_depth_rejects_last_frame`;
- `naadf.path_b_naadf_accepts_last_frame`;
- `naadf.path_b_current_kept_last_frame`;
- `naadf.path_b_refine_requests_last_frame`;
- `naadf.path_b_stale_or_unresident_last_frame`;
- `naadf.path_b_composite_passes_last_frame`.

Names may follow the existing `NaadfStats` and bench counter style, but the
semantic meanings above are fixed.

## Missing-Fine-Mip Safety

Path-B primary rays must never fabricate an exact foreground hit from coarse
data.

If a primary ray needs finer geometry than the resident mip can provide:

- do not present the coarse result as exact terrain;
- output a miss/current-renderer fallback in `HybridFarTerrain`;
- output a refine-request color in `DepthAudit`;
- increment `naadf.path_b_refine_requests_last_frame`;
- raise stream priority for that chunk or mark it as needing finer residency.

Lighting, GI, AO, and sun/fog rays may keep their existing conservative coarse
behavior. This stricter rule applies to Path-B primary visibility only.

## Sub-Tickets

### NAADF-230A: Mode, Config, And Debug Toggles

Goal:

Define the Path-B compositor mode and expose it through config/runtime/debug UI
without changing defaults.

Implementation notes:

- Extend NAADF config and preview settings with `Off`, `DebugPreview`,
  `HybridFarTerrain`, and `DepthAudit`.
- Keep existing `NaadfPreview` behavior mapped to `DebugPreview`.
- Add bench deserialization support for the mode.
- Do not alter current renderer behavior when the mode is `Off`.

Acceptance criteria:

- Default config keeps Path B off.
- Current renderer and Path A lighting modes run unchanged when Path B is off.
- Debug UI shows the selected mode and the last fallback/disabled reason.
- Bench summaries include the selected Path-B mode.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::config::tests
rtk cargo test --lib --features naadf bench::tests
```

### NAADF-230B: Raster Depth / Color Extraction Contract

Goal:

Bind the current scene color and depth data needed by the Path-B compositor.

Implementation notes:

- Reuse Bevy view target and prepass resources already available in the render
  graph where practical.
- Compare in linear view depth; add a helper/uniform path for depth
  reconstruction if only device depth is available.
- Use fallback dummy resources when depth is unavailable and record a disabled
  reason rather than failing the frame.
- Keep bindings explicit and documented beside the existing preview bind group
  layout.

Acceptance criteria:

- Path-B node can read current color and depth in `HybridFarTerrain` and
  `DepthAudit`.
- Missing depth leaves current output unchanged and records a diagnostic reason.
- No Path-B resources are required in current renderer mode.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::layout::tests
```

### NAADF-230C: Depth-Aware First-Hit / Compositor Shader

Goal:

Composite NAADF terrain behind raster geometry.

Implementation notes:

- Keep first-hit terrain output compatible with existing preview color/depth
  textures.
- Extend the compositor to load current depth, reconstruct linear raster depth,
  compare against NAADF hit depth, and choose current or NAADF color.
- Preserve current alpha behavior for misses and transparent preview output.
- `DepthAudit` should output deterministic diagnostic colors instead of final
  art.

Acceptance criteria:

- Raster foreground wins over NAADF hits.
- NAADF terrain appears only behind clear/far raster depth.
- Fullscreen/split/PIP debug preview behavior remains available.
- Shader metadata tests pin the bind contract and depth compare helper.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl
```

### NAADF-230D: Refine Requests And Stream Priority

Goal:

Expose missing-fine-mip and stale/unresident primary-hit conditions to stats and
streaming.

Implementation notes:

- Add first-hit diagnostic reason bits for missing fine mip, stale chunk, and
  unresident chunk.
- Count refine requests per frame.
- Feed refine-request chunk positions into NAADF streaming priority without
  duplicating dirty queue semantics.
- In `HybridFarTerrain`, keep current renderer output for refine-request pixels.

Acceptance criteria:

- Missing-fine primary rays never produce final Path-B terrain pixels.
- Refine requests are visible in stats, bench counters, and `DepthAudit`.
- Requested chunks become higher priority for fine residency.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::streaming::tests
rtk cargo test --features naadf --test naadf_gpu_layout
```

### NAADF-230E: Visual Benches And Guard Thresholds

Goal:

Make Path-B measurable before it can be called useful.

Implementation notes:

- Add a Path-B hybrid bench with raster foreground objects and far NAADF terrain.
- Add a depth-audit bench/checkpoint for screenshot inspection.
- Extend `bench_guard` optional NAADF checks for compositor pass time, depth
  rejects, NAADF accepts, refine requests, and frame regression.
- Keep current preview-only bench unchanged as a regression check for existing
  preview behavior.

Acceptance criteria:

- Current renderer baseline bench still passes.
- Path-B hybrid bench emits screenshots and NAADF counters.
- `bench_guard` can fail excessive compositor cost or refine-request rates.
- Screenshots prove water/props/foreground raster terrain remain in front.

Verification:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-hybrid.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

### NAADF-230F: Status Update And Release Evidence

Goal:

Update the documentation record only after implementation and verification.

Implementation notes:

- Add `NAADF-230` under completed work in `naadf-implementation-status.md` only
  after the hybrid bench and guard results exist.
- Record visual screenshot inspection, frame timings, relevant counters, and any
  fallback/dirty-worktree caveats.
- Keep `NAADF-240` and `NAADF-250` deferred.

Acceptance criteria:

- Status doc includes Added / Updated / Details / Checks.
- Bench run IDs and `summary.json` values are recorded.
- Any skipped visual/performance checks are stated explicitly.

## Deferred

- Full NAADF final renderer parity.
- NAADF-owned water rendering.
- Full vegetation, NPC, and dynamic prop voxelization.
- PBR material parity with the mesh renderer.
- Full atmosphere/cloud ownership.
- Replacing the current renderer in gameplay.
- Default promotion without fresh A/B visual benches and `bench_guard` evidence.

## Test Matrix

Non-visual:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::preview
rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl
rtk cargo test --features naadf --test naadf_gpu_layout
```

Runtime / visual:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-hybrid.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

Guard:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Screenshot inspection must include:

- foreground water/props/foliage/NPCs/buildings remain in front;
- far NAADF terrain appears only where current raster depth allows it;
- `DepthAudit` colors match the expected reject/accept/miss/refine categories;
- no blue silhouette/occupancy-only preview appears in settled Path-B output.

## Success Criteria

`NAADF-230` is complete when:

- Path B is selectable but default-off.
- `HybridFarTerrain` preserves current foreground raster geometry.
- `DepthAudit` can explain every Path-B pixel decision.
- Missing-fine primary rays fall back/refine instead of fabricating exact hits.
- Visual benches and `bench_guard` cover compositor cost and regressions.
- The implementation status doc records the evidence.

