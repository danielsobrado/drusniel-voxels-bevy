# NAADF Implementation Plan

Status: research spike plan  
Target release: v0.6 experimental backend, after v0.5 water and render performance stabilization  
Last reviewed: 2026-05-14

Companion detail: [NAADF Jira breakdown](./naadf-jira-breakdown.md) contains repo-aligned hook points, story IDs, file lists, and acceptance criteria for implementation planning.

NAADF is relevant to Drusniel, but it should enter the project as a voxel ray-query and GI acceleration backend, not as a replacement for the main terrain renderer.

The current renderer already has a large Bevy mesh/PBR stack: Surface Nets and blocky terrain modes, water reflections/refraction/caustics, displacement, props, vegetation, shadows, fog, clouds, post-processing, quality presets, debug toggles, and benchmark scenes. Replacing that with a full NAADF path tracer would be a renderer rewrite. The safer integration is to keep one world and one chunk system, then derive a NAADF GPU cache from the authoritative voxel data for GI, terrain visibility, shadows, AO, and preview rendering experiments.

Local hook points are already present. `Chunk` stores a fixed `[VoxelType; CHUNK_VOLUME]`, uses 16x16x16 local indexing, marks `MeshDirtyReason::TerrainMutation` from `set`/`try_set`, and exposes local voxel iteration. `VoxelWorld::apply_voxel_edit` marks the edited chunk dirty and also marks neighboring chunks dirty near chunk boundaries. `RayTracingSettings` is currently a small runtime toggle resource, while `RadianceCascadesPlugin` already owns SDF volume config/state and dirty chunk queues. Those are the intended first integration points.

## Source Summary

The public NAADF project, `cg-tuwien/NAADF`, describes a MonoGame engine using C# and HLSL. It groups `4^3` voxels into a block and `4^3` blocks into a chunk. Empty space is accelerated with axis-aligned distance fields cached in cells. Unlike scalar SDF data, these AADF values are directional along `x-`, `x+`, `y-`, `y+`, `z-`, and `z+`. The README also states that world generation happens on the GPU, while editing and entity logic run on the CPU and synchronize changes back to the GPU.

The TU Wien abstract reports that the nested structure accelerates ray tracing about 3-5x versus dense DAG-style structures, and that in-cell AADF caches can double throughput again, for a stated total around 10x. It also reports GI speedups, lower camera-motion artifacts, 32-frame TAA-style history retention, compressed lit/unlit sample accumulation, and 8x8 reservoir-style spatial resampling.

Drusniel should treat those claims as research targets, not guarantees. Every local performance claim must come from Drusniel release benches and `bench-runs/<run>/summary.json` comparisons.

References:

- TU Wien abstract: <https://www.cg.tuwien.ac.at/courses/konversatorium/NAADF-Globally-Illuminated-Voxel-Worlds-Accelerated-Nested-Axis-Aligned>
- NAADF repository: <https://github.com/cg-tuwien/NAADF>
- Ray traversal shader: <https://github.com/cg-tuwien/NAADF/blob/main/NAADF/Content/shaders/render/rayTracing.fxh>

## Decision

Implement NAADF as a derived acceleration cache and optional voxel ray backend.

Do not make NAADF the owner of voxel world state. Drusniel chunks, terrain edits, saves, colliders, mesh generation, LOD, and gameplay remain authoritative. NAADF buffers rebuild or incrementally update from dirty chunks, similar in spirit to mesh, collider, reflection, and displacement derived data.

Initial modes:

```text
Current
  Current mesh/PBR/water renderer plus current SDF GI.

CurrentWithNaadfGi
  Current mesh/PBR/water renderer plus NAADF ray backend for GI, shadow,
  AO, and visibility queries.

NaadfPreview
  Experimental direct voxel ray/path-traced preview for editor, screenshots,
  and R&D. This is not the gameplay renderer.
```

The key rule is:

```text
One world, one chunk system, one gameplay path, two optional voxel ray backends.
```

## Non-Goals

- Do not rewrite the main terrain renderer around NAADF during v0.5.
- Do not remove Surface Nets, blocky terrain, water, props, vegetation, fog, sky, shadows, or PBR materials.
- Do not make NAADF mandatory for gameplay.
- Do not assume the HLSL implementation ports directly to WGSL without a CPU reference.
- Do not ship NAADF as default until benchmarks, visual captures, memory use, dirty-update behavior, and integrated-GPU fallback are proven.

## Proposed Runtime Settings

The first implementation should add settings before adding NAADF logic. That makes benchmarks, UI, hotkeys, and fallback behavior testable with the current renderer still untouched.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoxelRayBackendMode {
    CurrentSdf,
    Naadf,
    Auto,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExperimentalRenderMode {
    Current,
    CurrentWithNaadfGi,
    NaadfPreview,
}
```

Example config shape:

```yaml
rendering:
  voxel_ray_backend: current_sdf
  experimental_render_mode: current

naadf:
  enabled: false
  build_visible_chunks_only: true
  max_chunk_updates_per_frame: 16
  max_gpu_memory_mb: 512
  allow_integrated_gpu: false
  debug_visualize: false
  use_for_sun_visibility: false
  use_for_terrain_ao: false
  use_for_contact_shadows: false
```

Benchmark toggle shape:

```toml
[render_toggles]
voxel_ray_backend = "current_sdf"
experimental_render_mode = "current"
```

Suggested hotkey:

```text
F11: cycle CurrentSdf -> Naadf -> Auto for the voxel ray backend.
```

The hotkey must only change state. It must not rebuild all NAADF buffers in one frame. When NAADF is selected but the cache is not ready, rendering should continue through the current SDF path and expose a warming/fallback state in diagnostics.

## Architecture

```text
World / Chunk Data
      |
      | source of truth
      v
Current Mesh Renderer -----------------------------+
      |                                            |
      |                                            v
Current SDF Ray Backend                 VoxelRayBackend trait
                                                   |
                                                   +-- CurrentSdf backend
                                                   |
                                                   +-- NAADF backend
                                                       |
                                                       +-- CPU reference
                                                       +-- GPU buffers
                                                       +-- WGSL traversal
                                                       +-- GI/shadow/AO queries
                                                       +-- preview renderer
```

Proposed module layout:

```text
src/rendering/
  voxel_ray_backend.rs
  naadf/
    mod.rs
    config.rs
    layout.rs
    cpu_builder.rs
    cpu_trace.rs
    gpu_buffers.rs
    extract.rs
    prepare.rs
    systems.rs
    debug.rs
    stats.rs
    preview.rs

assets/shaders/naadf/
  common.wgsl
  layout.wgsl
  build_blocks.wgsl
  build_chunks.wgsl
  build_bounds.wgsl
  ray_trace.wgsl
  gi_trace.wgsl
  first_hit.wgsl
  spatial_resampling.wgsl
  temporal_accumulation.wgsl
  debug_visualize.wgsl
```

Core interface:

```rust
pub trait VoxelRayBackend {
    fn name(&self) -> &'static str;

    fn trace(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
    ) -> Option<VoxelRayHit>;

    fn is_ready(&self) -> bool;
    fn stats(&self) -> VoxelRayBackendStats;
}
```

Shader-side integration should preserve a single call site for voxel world tracing:

```wgsl
fn trace_voxel_world(ray: Ray, purpose: u32) -> VoxelHit {
#if NAADF_BACKEND
    return trace_naadf(ray, purpose);
#else
    return trace_current_sdf(ray, purpose);
#endif
}
```

## Sprint Plan

Assumption: one sprint is roughly one week of focused work. For solo work alongside v0.5 stabilization, expect many sprints to stretch to 1.5-2 weeks.

### Sprint 0: Research Spike And Repo Audit

Goal: understand the NAADF implementation and decide the Drusniel integration boundary.

Tasks:

- Study `cg-tuwien/NAADF`, especially data layout, generation shaders, traversal shader, first-hit pass, GI pass, spatial resampling, and temporal accumulation.
- Map C# and HLSL pieces to Rust, Bevy, wgpu, and WGSL.
- Identify mandatory pieces for a first Drusniel backend: chunk/block/voxel layout, AADF generation, ray traversal, hit payloads, dirty updates, and debug statistics.
- Defer full primary rendering, temporal denoising, and preview accumulation until the ray backend is correct.

Acceptance criteria:

- This document exists and records the integration boundary.
- The final decision is explicit: NAADF starts as a voxel ray-query/GI backend, not the default full renderer.
- The deferred feature list is explicit.

### Sprint 1: Backend Abstraction And Settings Switch

Goal: support multiple voxel ray backends before NAADF exists.

Tasks:

- Add `VoxelRayBackendMode` and `ExperimentalRenderMode`.
- Add config and menu/debug settings.
- Add benchmark `render_toggles` support.
- Add `F11` or another unclaimed debug key.
- Record selected backend and render mode in bench summaries and debug overlay.

Acceptance criteria:

- Current renderer behavior is unchanged.
- The setting is visible in UI/debug output.
- Bench summaries record the selected backend.
- Selecting NAADF falls back to current SDF until a real backend exists.

### Sprint 2: CPU-Side NAADF Data Model

Goal: implement the NAADF layout in Rust without GPU dependency.

Tasks:

- Add `src/rendering/naadf/` with `layout.rs`, `cpu_builder.rs`, `cpu_trace.rs`, and `debug.rs`.
- Implement layout constants:

```rust
pub const VOXELS_PER_BLOCK_AXIS: u32 = 4;
pub const BLOCKS_PER_CHUNK_AXIS: u32 = 4;
pub const VOXELS_PER_CHUNK_AXIS: u32 = 16;
pub const VOXELS_PER_BLOCK: u32 = 64;
pub const BLOCKS_PER_CHUNK: u32 = 64;
```

- Define packed records for voxel, block, and chunk storage.
- Implement a CPU builder for small test chunks.
- Implement CPU `trace_ray()` against the packed layout.
- Add golden tests for empty chunk, full chunk, single voxel, wall, staircase, tunnel, and boundary-crossing rays.

Acceptance criteria:

- CPU tests prove layout and traversal semantics.
- Debug output can dump chunk, block, voxel, and AADF values.
- No Bevy render graph work is needed yet.

### Sprint 3: Chunk Extraction From Drusniel World

Goal: convert authoritative terrain/chunk data into NAADF input.

Tasks:

- Identify the canonical terrain/chunk storage path.
- Implement `NaadfChunkExtractor`.
- Convert Drusniel voxel/material IDs into compact NAADF material IDs.
- Add dirty events for terrain sculpting, block placement/removal, terrain conform, chunk load, and chunk unload.
- Track the visible NAADF region around player and camera.
- Add a dirty queue:

```rust
pub struct NaadfDirtyChunkQueue {
    pending: VecDeque<ChunkCoord>,
    in_flight: HashSet<ChunkCoord>,
}
```

Acceptance criteria:

- Loaded chunks produce equivalent NAADF chunks on CPU.
- Dirty edits mark NAADF chunks dirty.
- A debug command can compare current terrain occupancy against NAADF occupancy.

### Sprint 4: CPU Reference Ray Backend

Goal: make NAADF a real backend for validation and debug rays, still CPU-only.

Tasks:

- Implement `CurrentSdfRayBackend` and `NaadfCpuRayBackend`.
- Route debug raycasts through `VoxelRayBackend`.
- Add overlay stats: backend, chunk count, dirty queue length, ray count, average steps, and average hit distance.

Acceptance criteria:

- F11 can switch the debug ray backend.
- CPU NAADF hit results match current terrain for controlled scenes.
- Current renderer remains unchanged.

Hard gate A: proceed only if CPU NAADF tracing matches Drusniel terrain chunks in test scenes.

### Sprint 5: GPU Buffers And Upload Path

Goal: create NAADF GPU resources and upload CPU-built chunks.

Tasks:

- Add `gpu_buffers.rs`, `extract.rs`, and `prepare.rs`.
- Create voxel, block, chunk, material, dirty upload staging, and stats readback buffers.
- Start with flat storage buffers. Consider 3D textures only after profiling.
- Add a chunk slot table:

```rust
pub struct NaadfGpuChunkTable {
    chunk_to_slot: HashMap<ChunkCoord, u32>,
    free_slots: Vec<u32>,
}
```

- Add max chunks, max uploads/frame, max bytes/frame, and memory cap.
- Default to disabled on integrated GPUs unless explicitly allowed.

Acceptance criteria:

- GPU buffers allocate and appear in render diagnostics.
- Chunks upload without changing visual output.
- Integrated-GPU fallback is safe.

### Sprint 6: WGSL Ray Traversal Kernel

Goal: port NAADF ray traversal to WGSL and validate it against the CPU reference.

Tasks:

- Add `assets/shaders/naadf/ray_trace.wgsl`.
- Implement ray/AABB, chunk lookup, block lookup, voxel lookup, directional AADF skip, and hit result output.
- Add a compute test pass with input rays, output hits, and readback.
- Compare GPU hits to CPU golden scenes.
- Include ray purposes for primary debug, sun visibility, GI secondary, and AO/contact queries.

Acceptance criteria:

- GPU ray hit output matches CPU reference for golden tests.
- Debug visualization can draw hit points and normals.
- Average step count appears in debug overlay.

Hard gate B: do not integrate with GI until GPU hit correctness is reliable.

### Sprint 7: GPU AADF And Chunk Generation

Goal: generate NAADF data on GPU from raw chunk voxel data.

Tasks:

- Add `build_blocks.wgsl`, `build_chunks.wgsl`, and `build_bounds.wgsl`.
- Generate uniform empty/full block states, child block states, directional AADF skip fields, and chunk-level AADF values.
- Keep the CPU builder as reference and fallback.
- Add a validation pass comparing CPU-built and GPU-built outputs on small chunks.
- Budget dirty rebuilds across frames.

Acceptance criteria:

- GPU-generated chunks pass CPU comparison tests.
- Dirty chunks rebuild incrementally.
- Rebuild work respects frame budgets.

### Sprint 8: Sun Visibility, Terrain AO, And Contact Shadows

Goal: integrate NAADF into low-risk lighting queries before GI.

Tasks:

- Add NAADF-backed sun visibility queries.
- Add NAADF-backed terrain AO/debug AO mode.
- Add NAADF-backed contact shadow experiment.
- Add per-feature toggles under `naadf`.
- Add A/B bench coverage for forest look sweep, water shoreline, mountain/cave, and dig/edit checkpoints.

Acceptance criteria:

- Visual output is close to the current SDF path.
- Bench output includes ray counts and NAADF timings.
- Switching backend does not reset gameplay or chunk state.
- Camera motion does not introduce major flicker.

### Sprint 9: Radiance Cascades GI Backend Integration

Goal: let current GI use NAADF for voxel ray marching.

Tasks:

- Identify the current SDF ray-march path used by Radiance Cascades.
- Route GI ray tracing through `trace_voxel_world`.
- Use shader defs or pipeline specialization for backend selection.
- Integrate with Low/Medium/High/Ultra quality presets.
- Reset temporal history on backend switch.
- Add visual comparison captures.

Acceptance criteria:

- `CurrentSdf` and `Naadf` GI can be toggled by config, UI, hotkey, and bench toggle.
- GI output is stable enough for normal play.
- Bench scenes show timing rows for both paths.
- Fallback to current SDF always works.

Hard gate C: keep NAADF GI only if it is faster, cleaner, or meaningfully more scalable than the current SDF path in Drusniel scenes.

### Sprint 10: Debug And Tooling

Goal: make NAADF maintainable.

Tasks:

- Add overlays for NAADF chunks, dirty chunks, GPU slots, AADF skip-distance heatmap, ray step heatmap, and GI ray hit/miss visualization.
- Add debug commands to dump chunk data, rebuild a region, compare backend hits, freeze updates, force CPU builder, and force GPU builder.
- Add editor panel hooks for backend mode, chunk budget, memory use, and dirty queue.

Acceptance criteria:

- A broken chunk can be located visually.
- A shader mismatch can be narrowed to a single chunk/ray.
- Debugging does not require recompiling the game.

### Sprint 11: Streaming, Editing, And Persistence

Goal: make NAADF survive real gameplay.

Tasks:

- Stream NAADF chunks around player/camera.
- Add hysteresis so chunks are not repeatedly allocated and freed.
- Support place/remove/sculpt/terrain-conform edits.
- If the dirty queue grows too large, temporarily use current SDF.
- If NAADF cache is warming, show diagnostics but avoid hitches.
- Consider serialized NAADF chunk cache only if rebuild cost proves high.

Acceptance criteria:

- Digging, placing, sculpting, and building terrain edits do not leave stale GI/shadow artifacts longer than the configured update window.
- Gameplay smoke benches pass.
- World loading does not block on NAADF construction.

### Sprint 12: NAADF Preview Renderer

Goal: add an experimental full-screen NAADF preview mode, separate from the gameplay renderer.

Tasks:

- Add `ExperimentalRenderMode::NaadfPreview`.
- Add `first_hit.wgsl`, `preview_lighting.wgsl`, and `preview_composite.wgsl`.
- Render terrain voxels directly into a preview target.
- Either compose props, water, sky, and UI from the current renderer or intentionally disable them with a clear debug overlay.
- Add preview-only controls for ray steps, bounce count, accumulation, and debug material/sun modes.

Acceptance criteria:

- Settings can switch between current renderer, current renderer plus NAADF GI, and NAADF preview.
- Preview mode does not replace the gameplay renderer.
- History resets cleanly when switching.

### Sprint 13: Temporal Accumulation And Denoising

Goal: bring over the parts of NAADF that make GI visually compelling.

Tasks:

- Add history buffers.
- Reset history on camera cut, backend switch, terrain edit, FOV/resolution change, and time-of-day discontinuity.
- Add long-history accumulation experiment.
- Add spatial resampling pass.
- Add reservoir-style sample reuse only if it proves useful locally.
- Add ghosting/flicker debug views.

Acceptance criteria:

- Preview mode materially improves over multiple frames.
- Camera motion artifacts are reduced.
- Backend switching does not leave stale history.

Hard gate D: keep preview mode only if it is useful enough to maintain.

### Sprint 14: Production Hardening And Regression Guard

Goal: make NAADF safe to keep in the main branch, disabled by default.

Tasks:

- Add bench scenes:

```text
bench/scenes/visual-regression-naadf-current.toml
bench/scenes/visual-regression-naadf-gi.toml
bench/scenes/visual-regression-naadf-preview.toml
bench/scenes/gameplay-movement-naadf-smoke.toml
bench/scenes/dig-edit-naadf-stability.toml
```

- Extend `bench_guard` for max NAADF memory, max dirty queue age, max average ray steps, max frame-time regression, and screenshot diff thresholds if available.
- Add CI smoke tests for CPU layout and traversal.
- Add compile features:

```toml
[features]
naadf = []
naadf_debug = ["naadf"]
```

- Document user settings, developer debugging, fallback behavior, and known limitations.

Acceptance criteria:

- Main branch can ship with NAADF disabled by default.
- Performance benches compare current SDF and NAADF.
- Crash/fallback behavior is reliable.
- Documentation explains how to test and tune the system.

## Hard Gates

Gate A, after Sprint 4:

- CPU NAADF tracing must match Drusniel terrain chunks in test scenes.
- If it fails, keep the backend abstraction and stop the NAADF port until chunk representation issues are solved.

Gate B, after Sprint 6:

- GPU ray hits must match CPU ray hits.
- If it fails, keep CPU reference tooling and postpone GI integration.

Gate C, after Sprint 9:

- NAADF GI must be measurably valuable.
- Minimum pass target: same or better visual stability, no major lighting regressions, no gameplay hitches from chunk updates, memory within budget, and equal or better frame time in at least some important scenes.

Gate D, after Sprint 13:

- Preview mode must be useful enough to maintain.
- If it fails, ship only `CurrentWithNaadfGi`.

## Benchmarking Requirements

All performance-sensitive NAADF work must follow the repo profiling rules.

Baseline:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

Useful variants:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression-high.toml
rtk cargo run --release -- --bench bench/scenes/visual-regression-performance100.toml
rtk cargo run --release -- --bench bench/scenes/visual-regression-live-lod.toml
rtk cargo run --release -- --bench bench/scenes/collider-walk-log.toml
```

For every claimed improvement:

- Compare before/after `bench-runs/<run>/summary.json`.
- Report specific timing rows and counters. Do not add parent/child or overlapping timing rows together.
- Run `rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json` when touching known bottlenecks.
- Inspect fixed checkpoint screenshots for visual regressions.
- Include memory, dirty queue, average ray steps, rays traced, fallback count, and cache-ready state once those counters exist.

## Main Risks

Shader porting correctness is the largest risk. NAADF traversal is packed, directional, branchy, and easy to get almost right while producing rare misses or boundary errors.

Dirty chunk synchronization is the second risk. Drusniel supports live editing, sculpting, building, chunk streaming, colliders, and saves. NAADF must update as derived data and degrade gracefully when it is behind.

Memory pressure is the third risk. Current SDF data and NAADF buffers may both be resident. Integrated GPUs must default to safe behavior.

Visual integration is the fourth risk. The preview renderer will not automatically inherit water reflections, refraction, caustics, props, vegetation, PBR materials, sky, fog, clouds, UI, or post-processing.

## Definition Of Done

```text
[ ] Current renderer remains stable and default.
[ ] NAADF can be enabled by config, UI, hotkey, and bench toggle.
[ ] NAADF GPU cache builds from Drusniel chunks.
[ ] Dirty terrain edits update NAADF incrementally.
[ ] Current SDF and NAADF ray backends are A/B comparable.
[ ] GI, shadow, AO, and visibility queries can use NAADF.
[ ] Preview renderer exists but is clearly experimental.
[ ] Bench guard covers performance, memory, and gameplay stability.
[ ] Integrated-GPU fallback is safe.
[ ] Docs explain setup, limits, and debug workflow.
```

Recommended release framing:

```text
v0.6:
  Current renderer plus optional NAADF GI/shadow/AO backend.

v0.7:
  NAADF preview renderer plus temporal accumulation.

v0.8+:
  Decide whether NAADF can become a primary terrain renderer.
```
