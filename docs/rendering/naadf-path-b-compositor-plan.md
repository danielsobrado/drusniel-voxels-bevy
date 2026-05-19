# NAADF-230 Path-B Compositor Plan

Status: planned, default-off, feature-gated (`naadf`), experimental.  
Last updated: 2026-05-18  
Related: `naadf-lighting-plan.md`, `naadf-distance-lod-plan.md`,
`naadf-implementation-status.md`, `naadf-upstream-parity.md`,
`naadf-completion-jira-plan.md`.

This document defines `NAADF-230`: an optional hybrid primary / far-terrain
compositor. It is **not** a renderer replacement. It reuses the existing NAADF
preview pipeline where possible, adds a foreground/depth handshake with the
current renderer, and keeps Path A lighting independent.

`NAADF-230A` may land early as config/debug scaffolding. Real `HybridFarTerrain`
output must stay unavailable until the NAADF-200..210 foundation is stable:

- `NAADF-200` GPU dispatch;
- `NAADF-203` mip pyramid;
- `NAADF-207` world traversal;
- `NAADF-208` AADF skip traversal;
- `NAADF-209` cone-footprint LOD;
- `NAADF-210` texture parity.

Runtime availability should be an explicit gate, not an implied config state:

```rust
fn path_b_runtime_available(state: &NaadfRuntimeState) -> bool {
    state.gpu_dispatch_ready
        && state.gpu_traversal_parity_passed
        && state.world_traversal_ready
        && state.aadf_skip_ready
        && state.texture_parity_ready
}
```

## Non-Negotiables

- `VoxelWorld` remains authoritative for terrain, edits, saves, colliders, chunk
  streaming, and mesh generation.
- The current renderer remains default and production-owned.
- Path B is behind the `naadf` feature and a default-off runtime/config mode.
- `HybridFarTerrain` remains disabled until `path_b_runtime_available` passes.
- Path A lighting (`NAADF-211..218`) does not depend on Path B.
- Existing rastered geometry stays in front: water, props, foliage, NPCs,
  buildings, editor overlays, and UI are not replaced by NAADF. This requires a
  foreground coverage mask in addition to opaque scene depth.
- NAADF must never panic or hard-take-over on missing buffers, missing resident
  chunks, stale cache, or allocation failure. It falls back to current output.
- Path B is not evidence that legacy mesh LOD seams are fixed. It may hide far
  gaps in specific modes, but mesh-side LOD bugs still require mesh-side fixes
  and bench evidence.

## Path-B V1 Behavior

Path-B v1 composites NAADF terrain behind the current scene:

1. Current renderer produces scene color, depth, and foreground coverage.
2. NAADF first-hit traces terrain from the active camera using the existing
   GPU cache, mip traversal, texture atlas, fog, lighting hooks, and preview
   history/filter passes where enabled.
3. The compositor compares current raster depth and NAADF hit depth in
   **linear view depth**. Do not compare raw device-depth values or normalized
   ray distance against linear raster depth.
4. Current scene color wins when foreground coverage is present.
5. Current scene color also wins when raster depth is in front of the NAADF hit.
6. NAADF color is allowed only where raster depth is absent, sky/far clear, or
   farther than the NAADF terrain hit.
7. Misses, stale chunks, unresident chunks, and missing-fine-mip primary hits
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
- foreground coverage rejects;
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
- foreground coverage mask, including opaque depth coverage, water mask,
  alpha-cutout foliage/prepass coverage where available, and editor overlay
  exclusion where needed;
- camera projection/view data needed to reconstruct linear view depth;
- NAADF first-hit color, linear view depth, ray distance, normal, motion, and
  diagnostic reason outputs;
- NAADF Path-B ownership mask, used by temporal/filter passes after the
  compositor establishes current-frame ownership;
- optional NAADF temporal/spatial/denoise outputs;
- NAADF cache, chunk lookup, terrain atlas, local-light records, and stats
  buffers already used by the preview pipeline.

Pass order:

1. Current renderer writes scene color/depth as usual.
2. Current renderer or a lightweight extraction pass writes foreground coverage.
3. NAADF build/upload passes update the GPU cache if preview/Path-B is active.
4. NAADF first-hit writes hit color, linear view depth, ray distance, normal,
   motion, alpha, and diagnostic reason. Normalized ray distance may remain as a
   diagnostic channel, but it is not the compositor depth.
5. Depth-aware Path-B compositor reads current color/depth, foreground coverage,
   and the selected NAADF color/depth source, applies ownership, and writes the
   final view target.
6. Optional temporal/spatial/denoise integration runs only after the basic
   depth-aware compositor is correct, and must reject history when ownership
   changes.

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
- `path_b_enable_temporal`, default `false` until the ownership-mask history
  rejection path is implemented;
- `path_b_audit_overlay_alpha`, used only by `DepthAudit`;
- `path_b_counters_enabled`, default `false`, debug/bench only;
- bench override enabling Path-B counters/readback;
- bench toggle for Path-B compositor mode.

Stats/counters:

- `naadf.path_b_depth_rejects_last_frame`;
- `naadf.path_b_coverage_rejects_last_frame`;
- `naadf.path_b_naadf_accepts_last_frame`;
- `naadf.path_b_current_kept_last_frame`;
- `naadf.path_b_refine_requests_last_frame`;
- `naadf.path_b_stale_or_unresident_last_frame`;
- `naadf.path_b_ownership_changes_last_frame`;
- `naadf.path_b_composite_passes_last_frame`.

Names may follow the existing `NaadfStats` and bench counter style, but the
semantic meanings above are fixed.

Per-pixel counter atomics must not run in normal gameplay. Enable them only for
debug, `DepthAudit`, and bench modes where readback cost is intentional.

Path-B ownership mask:

```text
0 = current renderer owns pixel
1 = NAADF owns pixel
2 = audit/refine/missing
```

Temporal accumulation must reset or reject history when previous and current
ownership differ.

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
- Add `path_b_runtime_available`/disabled-reason plumbing, but keep
  `HybridFarTerrain` unavailable until `NAADF-200..210` pass.
- Do not alter current renderer behavior when the mode is `Off`.

Acceptance criteria:

- Default config keeps Path B off.
- This ticket is safe to land before `NAADF-200..210`; it must not produce real
  `HybridFarTerrain` output before the runtime gate passes.
- Current renderer and Path A lighting modes run unchanged when Path B is off.
- Debug UI shows the selected mode and the last fallback/disabled reason.
- Bench summaries include the selected Path-B mode.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::config::tests
rtk cargo test --lib --features naadf bench::tests
```

### NAADF-230B: Raster Color / Depth / Foreground Coverage Contract

Goal:

Bind the current scene color, depth, and foreground coverage data needed by the
Path-B compositor.

Implementation notes:

- Reuse Bevy view target and prepass resources already available in the render
  graph where practical.
- Compare in linear view depth; add a helper/uniform path for depth
  reconstruction if only device depth is available.
- Bind foreground coverage, not depth alone. Coverage includes opaque depth
  coverage, water mask, alpha-cutout foliage/prepass coverage where available,
  and editor overlay exclusion where needed.
- Use fallback dummy resources when depth is unavailable and record a disabled
  reason rather than failing the frame.
- Keep bindings explicit and documented beside the existing preview bind group
  layout.

Acceptance criteria:

- Path-B node can read current color, depth, and foreground coverage in
  `HybridFarTerrain` and `DepthAudit`.
- Missing depth or foreground coverage leaves current output unchanged and
  records a diagnostic reason.
- Water and alpha-cutout/transparent foreground have a protection path that does
  not rely on normal opaque depth writes.
- No Path-B resources are required in current renderer mode.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::layout::tests
```

### NAADF-230C1: Depth-Aware First-Hit / Compositor Shader

Goal:

Composite NAADF terrain behind raster geometry without temporal/spatial/denoise
integration.

Implementation notes:

- Add or redefine the first-hit depth output so the compositor reads linear view
  depth. Normalized hit distance may be retained as a separate diagnostic
  channel but must not be compared against raster linear view depth.
- Prefer an explicit first-hit depth/debug texture contract:

```text
R = linear view depth
G = ray distance
B = diagnostic reason
A = hit alpha
```

- Extend the compositor to load current depth, reconstruct linear raster depth,
  check foreground coverage first, compare against NAADF linear view depth, and
  choose current or NAADF color.
- Preserve current alpha behavior for misses and transparent preview output.
- `DepthAudit` should output deterministic diagnostic colors instead of final
  art.
- The basic compositor decision is:

```wgsl
if foreground_coverage > 0.0 {
    return current_color;
}

if raster_depth_is_valid && raster_linear_depth <= naadf_linear_depth + epsilon {
    return current_color;
}

return naadf_color;
```

Acceptance criteria:

- Foreground coverage wins over NAADF hits before depth comparison.
- Raster depth wins over NAADF hits when current depth is nearer.
- NAADF terrain appears only behind clear/far raster depth.
- Fullscreen/split/PIP debug preview behavior remains available.
- Shader metadata tests pin the bind contract, first-hit linear-depth output,
  coverage check, and depth compare helper.

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

### NAADF-230C2: Temporal / Spatial / Denoise Integration

Goal:

Integrate Path-B ownership with temporal, spatial, and denoise passes only after
`NAADF-230C1` and `NAADF-230D` are clean.

Implementation notes:

- Write `naadf_path_b_ownership_mask` from the depth-aware compositor.
- Reject or reset temporal history when previous and current ownership differ.
- Preserve current renderer pixels at ownership transitions, water edges,
  foliage silhouettes, camera-motion edges, and terrain LOD/cull boundaries.
- Keep debug preview temporal behavior unchanged when not running Path B.

Acceptance criteria:

- Ownership changes do not leak old NAADF color into raster foreground pixels.
- `DepthAudit` can visualize current-owned, NAADF-owned, and
  audit/refine/missing ownership.
- Temporal/spatial/denoise passes remain optional and disabled by fallback when
  required ownership resources are unavailable.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --lib --features naadf rendering::naadf::preview
rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl
```

### NAADF-230E: Visual Benches And Guard Thresholds

Goal:

Make Path-B measurable before it can be called useful.

Implementation notes:

- Add a Path-B hybrid bench with raster foreground objects and far NAADF terrain.
- Add a depth-audit bench/checkpoint for screenshot inspection.
- Extend `bench_guard` optional NAADF checks for compositor pass time, depth
  rejects, coverage rejects, NAADF accepts, refine requests, ownership changes,
  and frame regression.
- Enable per-pixel Path-B counters in benches/DepthAudit only.
- Keep current preview-only bench unchanged as a regression check for existing
  preview behavior.

Acceptance criteria:

- Current renderer baseline bench still passes.
- Path-B hybrid bench emits screenshots and NAADF counters.
- `bench_guard` can fail excessive compositor cost or refine-request rates.
- Screenshots prove water/props/foliage/foreground raster terrain remain in
  front and that Path B is not being used as proof of a mesh LOD fix.

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
- foreground coverage masks protect water and alpha-cutout/transparent
  foreground where depth alone would be insufficient;
- `DepthAudit` colors match the expected reject/accept/miss/refine categories;
- ownership transitions do not produce temporal halos or old NAADF color leaks;
- no blue silhouette/occupancy-only preview appears in settled Path-B output.

## Success Criteria

`NAADF-230` is complete when:

- Path B is selectable but default-off.
- Real `HybridFarTerrain` output is gated behind `NAADF-200..210` readiness.
- `HybridFarTerrain` preserves current foreground raster geometry.
- `DepthAudit` can explain every Path-B pixel decision.
- Missing-fine primary rays fall back/refine instead of fabricating exact hits.
- Temporal history respects Path-B ownership.
- Visual benches and `bench_guard` cover compositor cost and regressions.
- The implementation status doc records the evidence.
