# NAADF Jira Breakdown

Status: implementation story breakdown  
Parent plan: [NAADF implementation plan](./naadf-implementation-plan.md)  
Last reviewed: 2026-05-14

This document turns the NAADF plan into copyable implementation stories. It is intentionally more concrete than the parent plan and names Drusniel hook points verified in the local tree.

## Verified Hook Points

Do not create a second world model. `VoxelWorld` remains authoritative and NAADF is a derived acceleration cache fed by dirty chunks.

The match is unusually clean:

- Drusniel chunks are fixed 16x16x16 voxel chunks through `CHUNK_SIZE` and `CHUNK_VOLUME`.
- `Chunk` stores `[VoxelType; CHUNK_VOLUME]`.
- `Chunk::index()` uses `x + y * 16 + z * 256`, which should be mirrored by NAADF CPU and WGSL layout code.
- `Chunk::set()` and `Chunk::try_set()` mark `MeshDirtyReason::TerrainMutation`, invalidate uniformity, and mark face visibility dirty.
- `Chunk::iter()` exposes local voxel coordinates without render-world state.
- `VoxelWorld::apply_voxel_edit()` already computes `world_to_chunk()` and `world_to_local()`, applies the edit, and marks neighboring chunks dirty near boundaries.
- `RadianceCascadesPlugin` already owns `RadianceCascadesConfig` and `SdfVolumeState`, including dirty chunk queues, SDF resolution/world bounds, incremental update config, and CPU fallback SDF texture creation.
- `RayTracingSettings` currently only carries `enabled: bool`, making it a low-risk place to add backend state without changing current default behavior.
- `RenderingPlugin` already initializes `RayTracingSettings`, `RenderQualityPreset`, render timing, water, reflections, GTAO, god rays, weather overlay, shadow budgets, and render material plugins.

The first production integration point is therefore:

```text
VoxelWorld / Chunk
  authoritative source of truth
        |
        v
NAADF derived cache
        |
        +-- CPU reference builder/tracer
        +-- GPU buffers and WGSL traversal
        +-- Radiance Cascades / shadow / AO backend
```

The current mesh/PBR/water renderer remains default.

## Source-To-Target Port Map

```text
NAADF source                              Drusniel target
----------------------------------------------------------------------------
NAADF/Content/shaders/render/rayTracing.fxh
                                          assets/shaders/naadf/ray_trace.wgsl

NAADF/Content/shaders/world/data/chunkCalc.fx
                                          assets/shaders/naadf/build_blocks.wgsl
                                          assets/shaders/naadf/build_chunks.wgsl
                                          assets/shaders/naadf/build_bounds.wgsl

NAADF/Content/shaders/render/renderGlobalIllum.fx
                                          assets/shaders/naadf/gi_trace.wgsl

NAADF/Content/shaders/render/renderFirstHit.fx
                                          assets/shaders/naadf/first_hit.wgsl

NAADF/Content/shaders/render/renderSpatialResampling.fx
                                          assets/shaders/naadf/spatial_resampling.wgsl

NAADF/Content/shaders/render/renderTaaSampleReverse.fx
                                          assets/shaders/naadf/temporal_accumulation.wgsl
```

References:

- NAADF repository: <https://github.com/cg-tuwien/NAADF>
- Ray traversal source: <https://raw.githubusercontent.com/cg-tuwien/NAADF/main/NAADF/Content/shaders/render/rayTracing.fxh>
- Chunk build source: <https://raw.githubusercontent.com/cg-tuwien/NAADF/main/NAADF/Content/shaders/world/data/chunkCalc.fx>

## Story Set

### NAADF-000: Create Port Plan And Risk Register

Goal: capture the technical map before runtime code changes.

Files:

```text
docs/rendering/naadf-port-plan.md
docs/rendering/naadf-risk-register.md
```

Acceptance criteria:

```text
[ ] Explain why VoxelWorld stays authoritative.
[ ] Explain why NAADF starts as GI/ray backend, not renderer replacement.
[ ] List every NAADF shader file to port.
[ ] List every Drusniel module to touch.
[ ] Define hard gates after CPU parity, GPU parity, and GI benchmark.
```

### NAADF-001: Add Feature Flags And Module Skeleton

Goal: add compile-time shape without changing runtime behavior.

Files:

```text
Cargo.toml
src/rendering/mod.rs
src/rendering/voxel_ray_backend.rs
src/rendering/naadf/mod.rs
src/rendering/naadf/config.rs
src/rendering/naadf/layout.rs
src/rendering/naadf/stats.rs
assets/shaders/naadf/.gitkeep
```

Implementation sketch:

```toml
[features]
naadf = []
naadf_debug = ["naadf"]
```

```rust
#[cfg(feature = "naadf")]
pub mod naadf;

pub mod voxel_ray_backend;
```

Acceptance criteria:

```text
[ ] cargo check passes without --features naadf.
[ ] cargo check --features naadf passes.
[ ] No runtime behavior changes with the feature disabled.
[ ] No shader asset is loaded yet.
```

### NAADF-002: Add Fixture List And Golden Scenes

Goal: define CPU/GPU parity scenes.

Files:

```text
tests/fixtures/naadf/
  empty_chunk.ron
  full_chunk.ron
  single_voxel.ron
  wall_x.ron
  wall_y.ron
  wall_z.ron
  staircase.ron
  tunnel.ron
  chunk_boundary.ron
  bedrock_floor.ron
```

Acceptance criteria:

```text
[ ] Fixtures cover empty, full, sparse, boundary, and diagonal traversal cases.
[ ] Fixtures construct `Chunk` data without render-world state.
[ ] Fixture ray expectations are documented.
```

### NAADF-010: Expand RayTracingSettings Into Backend State

Goal: use `src/rendering/ray_tracing.rs` as the first runtime switch point.

Files:

```text
src/rendering/ray_tracing.rs
src/rendering/plugin.rs
src/rendering/quality.rs
```

Implementation sketch:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Reflect, Serialize, Deserialize)]
pub enum VoxelRayBackendMode {
    CurrentSdf,
    Naadf,
    Auto,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Reflect, Serialize, Deserialize)]
pub enum ExperimentalRenderMode {
    Current,
    CurrentWithNaadfGi,
    NaadfPreview,
}

#[derive(Resource, Clone, Debug, Reflect, Serialize, Deserialize)]
pub struct RayTracingSettings {
    pub enabled: bool,
    pub voxel_backend: VoxelRayBackendMode,
    pub experimental_mode: ExperimentalRenderMode,
    pub allow_naadf_on_integrated_gpu: bool,
    pub reset_history_on_backend_switch: bool,
}
```

Acceptance criteria:

```text
[ ] Default remains current renderer/current SDF.
[ ] Existing code using RayTracingSettings still compiles.
[ ] New enum values are reflectable/serializable.
[ ] Integrated GPU default does not enable NAADF.
```

### NAADF-011: Add F11 Backend Toggle

Goal: runtime toggle between current GI backend and NAADF backend.

Files:

```text
src/input/mod.rs
src/rendering/ray_tracing.rs
src/debug_ui.rs
```

Implementation notes:

- Use F11 because existing debug controls already use F3-F10, F12, and Alt+1 through Alt+4.
- The hotkey changes state only. It must not rebuild NAADF buffers in the input system.
- If NAADF is blocked by integrated GPU policy, keep the current backend and log the fallback reason.
- Emit or reuse a render-history invalidation event when switching backend.

Acceptance criteria:

```text
[ ] F11 toggles CurrentSdf <-> Naadf.
[ ] Toggle is visible in F3/debug overlay.
[ ] Integrated GPU fallback blocks NAADF unless override is set.
[ ] Backend switch resets GI/preview history once history exists.
```

### NAADF-012: Add Config Keys

Goal: configure NAADF in the same style as rendering configs.

Files:

```text
assets/config/naadf.yaml
src/config/mod.rs
src/rendering/naadf/config.rs
```

Config shape:

```yaml
enabled: false
build_visible_chunks_only: true

chunk_cache:
  radius_chunks: 12
  hysteresis_chunks: 2
  max_chunks: 4096
  max_chunk_updates_per_frame: 4
  max_upload_bytes_per_frame: 4194304
  max_gpu_memory_mb: 512

gpu:
  allow_integrated_gpu: false
  prefer_gpu_builder: false
  debug_readback: false

debug:
  visualize_chunks: false
  visualize_ray_steps: false
  visualize_aadf_bounds: false
  compare_cpu_gpu: false
```

Acceptance criteria:

```text
[ ] Config loads with sane defaults if file is missing.
[ ] Config can disable all NAADF systems.
[ ] Integrated GPU override exists and defaults false.
[ ] Dirty update budgets are configurable.
```

### NAADF-013: Extend Bench Render Toggles

Goal: make A/B testing reproducible.

Files:

```text
src/bench/mod.rs
bench/scenes/visual-regression-naadf-current.toml
bench/scenes/visual-regression-naadf-gi.toml
bench/scenes/gameplay-movement-naadf-smoke.toml
```

Fields:

```rust
pub voxel_ray_backend: Option<String>,
pub experimental_render_mode: Option<String>,
pub naadf_force_cpu_builder: Option<bool>,
pub naadf_force_gpu_builder: Option<bool>,
pub naadf_max_chunk_updates_per_frame: Option<u32>,
```

Acceptance criteria:

```text
[ ] Bench summaries include selected voxel backend.
[ ] Bench can force CurrentSdf or Naadf.
[ ] Bench can cap NAADF chunk updates per frame.
[ ] Existing bench scenes remain unchanged.
```

### NAADF-020: Implement Layout Constants

Goal: encode NAADF's 4x4x4 block and 4x4x4 chunk hierarchy exactly once.

Files:

```text
src/rendering/naadf/layout.rs
```

Implementation sketch:

```rust
pub const VOXELS_PER_BLOCK_AXIS: u32 = 4;
pub const BLOCKS_PER_CHUNK_AXIS: u32 = 4;
pub const VOXELS_PER_CHUNK_AXIS: u32 = 16;
pub const VOXELS_PER_BLOCK: u32 = 64;
pub const BLOCKS_PER_CHUNK: u32 = 64;
pub const VOXELS_PER_CHUNK: u32 = 4096;

pub fn voxel_index_in_chunk(local: UVec3) -> usize {
    (local.x + local.y * 16 + local.z * 256) as usize
}
```

Acceptance criteria:

```text
[ ] Constants match NAADF 4^3 block / 4^3 chunk structure.
[ ] Indexing matches `Chunk::index()`.
[ ] Unit tests cover all boundary values.
```

### NAADF-021: Define Packed CPU Records

Goal: create CPU-side equivalents of GPU node records.

Files:

```text
src/rendering/naadf/layout.rs
```

Acceptance criteria:

```text
[ ] CPU records represent empty, full, and child nodes.
[ ] Packing reserves the top two bits for node state.
[ ] Unit tests verify round-trip packing.
```

### NAADF-022: Build CPU NAADF Chunk From Chunk

Goal: convert a Drusniel `Chunk` into NAADF layout.

Files:

```text
src/rendering/naadf/cpu_builder.rs
src/rendering/naadf/mod.rs
```

Important rule:

```text
Do not treat water as opaque solid in the initial NAADF GI traversal.
The v0.5 water renderer/refraction/reflection stack remains authoritative for water.
```

Acceptance criteria:

```text
[ ] Empty chunk builds UniformEmpty.
[ ] Full stone chunk builds UniformFull.
[ ] Mixed chunk builds Child with 64 block positions.
[ ] Water is not opaque solid initially.
[ ] Material IDs are stable and deterministic.
```

### NAADF-023: Compute Directional Bounds On CPU

Goal: compute AADF skip bounds in reference form.

Files:

```text
src/rendering/naadf/cpu_builder.rs
src/rendering/naadf/layout.rs
```

Acceptance criteria:

```text
[ ] Empty block returns 4 for all six directions.
[ ] Full block returns 0 for all six directions.
[ ] Single voxel at local (0,0,0) returns expected directional distances.
[ ] Bounds are logged in debug format.
```

### NAADF-024: CPU Layout Unit Tests

Goal: lock CPU layout before GPU work.

Files:

```text
tests/naadf_cpu_layout.rs
```

Acceptance criteria:

```text
[ ] Fixture chunks build deterministically.
[ ] Tests do not require a GPU.
[ ] Tests fail if layout constants change accidentally.
```

### NAADF-030: Implement NaadfChunkExtractor

Goal: extract NAADF chunks from `VoxelWorld`.

Files:

```text
src/rendering/naadf/extractor.rs
```

Acceptance criteria:

```text
[ ] Extractor builds NAADF chunks from loaded Drusniel chunks.
[ ] Missing chunks are reported as missing, not converted to empty.
[ ] Extractor has no render-world dependency.
```

### NAADF-031: Add NaadfDirtyChunkQueue

Goal: track chunks needing NAADF cache rebuild.

Files:

```text
src/rendering/naadf/dirty.rs
src/rendering/naadf/stats.rs
```

Acceptance criteria:

```text
[ ] Queue de-duplicates chunk positions.
[ ] Queue tracks pending and in-flight chunks.
[ ] Queue exposes stats for debug overlay and bench counters.
```

### NAADF-032: Hook Dirty Queue Into Terrain Mutation

Goal: every terrain edit that dirties meshes also dirties NAADF.

Files:

```text
src/voxel/world.rs
src/voxel/plugin.rs
src/rendering/naadf/dirty.rs
```

Preferred approach:

```text
Add an explicit voxel/chunk mutation event from the edit path.
```

Fallback approach:

```text
Scan `VoxelWorld` dirty chunks before existing mesh dirty processing clears flags.
```

Ordering requirement:

```text
Run NAADF dirty queueing after chunk generation polling and before mesh dirty processing.
```

Acceptance criteria:

```text
[ ] Breaking/placing blocks queues the edited NAADF chunk.
[ ] Boundary edits queue neighboring NAADF chunks.
[ ] Generated chunks are queued for initial NAADF build.
[ ] Dirty queue does not duplicate chunks.
```

### NAADF-033: Add Occupancy Comparison Diagnostics

Goal: prove extraction matches terrain occupancy.

Files:

```text
src/rendering/naadf/debug.rs
```

Acceptance criteria:

```text
[ ] Debug command compares one targeted chunk.
[ ] Debug command reports first N mismatches.
[ ] Golden fixtures produce zero mismatch.
```

### NAADF-040: Create VoxelRayBackend Abstraction

Goal: route current SDF and NAADF through one conceptual interface.

Files:

```text
src/rendering/voxel_ray_backend.rs
src/rendering/mod.rs
```

Types:

```rust
pub enum VoxelRayPurpose {
    Debug,
    SunVisibility,
    GiSecondary,
    TerrainAo,
    ContactShadow,
    PreviewPrimary,
}
```

Acceptance criteria:

```text
[ ] Backend abstraction compiles without GPU.
[ ] Purpose enum covers GI/shadow/AO/debug/preview.
[ ] Stats are generic enough for current SDF and NAADF.
```

### NAADF-041: Implement CPU NAADF Ray Traversal

Goal: build a slow but correct CPU reference.

Files:

```text
src/rendering/naadf/cpu_trace.rs
```

Acceptance criteria:

```text
[ ] CPU rays hit full chunks.
[ ] CPU rays miss empty chunks.
[ ] CPU rays hit single-voxel fixture.
[ ] CPU rays cross chunk boundaries.
[ ] CPU step count is recorded.
```

### NAADF-042: Add Current SDF Backend Wrapper

Goal: make existing world/SDF path comparable to NAADF.

Files:

```text
src/rendering/voxel_ray_backend.rs
src/rendering/radiance_cascades.rs
```

Acceptance criteria:

```text
[ ] CPU debug ray can run through current world path.
[ ] Current and NAADF outputs can be compared for fixtures.
[ ] Production GI is unchanged.
```

### NAADF-043: Add A/B Debug Ray Comparison

Goal: detect mismatches before GPU integration.

Files:

```text
src/rendering/naadf/debug.rs
src/debug_ui.rs
```

Acceptance criteria:

```text
[ ] Debug overlay reports mismatch count.
[ ] Can dump first mismatch ray.
[ ] Fixtures produce zero mismatch.
```

### NAADF-050: Add GPU Buffers

Goal: allocate GPU storage for NAADF chunk, block, voxel, material, upload, debug ray, and stats buffers.

Files:

```text
src/rendering/naadf/gpu_buffers.rs
src/rendering/naadf/mod.rs
```

Acceptance criteria:

```text
[ ] Buffers are created only when feature/config is enabled.
[ ] Buffer size is capped by config.
[ ] Integrated GPU fallback prevents allocation unless override is enabled.
[ ] GPU memory estimate is recorded.
```

### NAADF-051: Implement GPU Chunk Slot Table

Goal: map Drusniel chunk coordinates to NAADF GPU slots.

Files:

```text
src/rendering/naadf/gpu_buffers.rs
src/rendering/naadf/dirty.rs
```

Acceptance criteria:

```text
[ ] Allocates stable slot for loaded chunk.
[ ] Reuses slots after unload.
[ ] Does not exceed max chunk capacity.
[ ] Debug overlay shows used/free slots.
```

### NAADF-052: Upload CPU-Built Chunks To GPU

Goal: upload CPU reference chunks before implementing GPU build.

Files:

```text
src/rendering/naadf/prepare.rs
src/rendering/naadf/gpu_buffers.rs
```

Acceptance criteria:

```text
[ ] Dirty CPU chunks upload to GPU buffers.
[ ] Uploads are budgeted per frame.
[ ] No render pipeline reads NAADF buffers yet.
[ ] Stats show upload count and bytes.
```

### NAADF-053: Register NAADF Render Systems

Goal: integrate with Bevy render app without affecting the main renderer.

Files:

```text
src/rendering/naadf/mod.rs
src/rendering/plugin.rs
```

Acceptance criteria:

```text
[ ] Render app owns GPU resources.
[ ] Main app owns CPU/dirty state.
[ ] Feature can be disabled cleanly.
[ ] Existing RenderingPlugin behavior remains unchanged.
```

### NAADF-060: Create WGSL Layout/Common Shader

Goal: mirror Rust layout in WGSL.

Files:

```text
assets/shaders/naadf/common.wgsl
assets/shaders/naadf/layout.wgsl
```

Acceptance criteria:

```text
[ ] WGSL constants match Rust constants.
[ ] Shader imports compile.
[ ] Rust-side tests verify constants if practical.
```

### NAADF-061: Port Ray Traversal To WGSL

Goal: implement `trace_naadf` equivalent to NAADF ray traversal.

Files:

```text
assets/shaders/naadf/ray_trace.wgsl
```

Implementation notes:

- Port chunk -> block -> voxel traversal.
- Decode packed node state.
- Use directional AADF bounds only after CPU/GPU parity tests pass.
- Cap steps by ray purpose.

Acceptance criteria:

```text
[ ] Shader compiles.
[ ] Empty/full/single-voxel fixture rays match CPU.
[ ] Step limits match ray purpose.
[ ] Miss behavior is deterministic.
```

### NAADF-062: Add GPU Ray Test Harness

Goal: run test rays through WGSL and compare readback to CPU.

Files:

```text
src/rendering/naadf/pipeline.rs
src/rendering/naadf/gpu_tests.rs
assets/shaders/naadf/debug_trace_rays.wgsl
```

Acceptance criteria:

```text
[ ] GPU readback returns one hit per input ray.
[ ] CPU/GPU hit/miss parity for fixtures.
[ ] CPU/GPU hit distance tolerance <= 0.05 voxel units.
[ ] CPU/GPU material ID parity.
```

### NAADF-063: Add Debug Hit Visualization

Goal: visualize GPU ray hits and normals in-game.

Files:

```text
src/rendering/naadf/debug.rs
src/debug_ui.rs
```

Acceptance criteria:

```text
[ ] Debug rays appear in world.
[ ] Hit normals appear.
[ ] Overlay shows average GPU step count.
```

### NAADF-070: Add Raw Voxel Upload Buffer

Goal: upload raw 16^3 chunk voxel/material data before GPU build.

Files:

```text
src/rendering/naadf/gpu_buffers.rs
src/rendering/naadf/prepare.rs
```

Acceptance criteria:

```text
[ ] Raw chunk buffer contains 4096 records per chunk.
[ ] Raw voxel packing matches CPU builder.
[ ] Upload is budgeted per frame.
```

### NAADF-071: Port Block Build Pass

Goal: generate block records from raw voxel chunk data on GPU.

Files:

```text
assets/shaders/naadf/build_blocks.wgsl
src/rendering/naadf/pipeline.rs
```

Acceptance criteria:

```text
[ ] GPU block builder handles empty/full/mixed blocks.
[ ] GPU output matches CPU builder for fixtures.
[ ] Hash/dedup is deferred until correctness is proven.
```

### NAADF-072: Add Bounds Build Pass

Goal: compute voxel/block/chunk AADF bounds on GPU.

Files:

```text
assets/shaders/naadf/build_bounds.wgsl
```

Acceptance criteria:

```text
[ ] Bounds match CPU for all fixtures.
[ ] Bounds are packed into node words or a sidecar buffer.
[ ] Ray traversal uses bounds only after parity passes.
```

### NAADF-073: Add Incremental GPU Build Queue

Goal: rebuild only dirty chunks under frame budget.

Files:

```text
src/rendering/naadf/prepare.rs
src/rendering/naadf/pipeline.rs
```

Acceptance criteria:

```text
[ ] Dirty chunks rebuild across frames.
[ ] Rebuild does not hitch gameplay.
[ ] Queue length and oldest dirty age are visible.
```

### NAADF-080: Add Sun Visibility Query

Goal: first visual use through terrain sun occlusion.

Files:

```text
assets/shaders/naadf/ray_trace.wgsl
assets/shaders/naadf/lighting_queries.wgsl
src/rendering/naadf/pipeline.rs
```

Acceptance criteria:

```text
[ ] Can toggle current sun terrain visibility vs NAADF visibility.
[ ] Visual difference is explainable.
[ ] No history accumulation involved yet.
```

### NAADF-081: Add Terrain AO / Contact Shadow Experiment

Goal: test short-distance NAADF occlusion before GI.

Files:

```text
assets/shaders/naadf/lighting_queries.wgsl
src/rendering/ao_config.rs
src/rendering/ray_tracing.rs
```

Acceptance criteria:

```text
[ ] AO query has feature toggle.
[ ] Query can be disabled independently from GI.
[ ] Step count and cost are recorded.
```

### NAADF-082: Add Quality Preset Integration

Goal: adapt NAADF budgets to existing quality presets.

Files:

```text
src/rendering/quality.rs
src/rendering/naadf/config.rs
```

Acceptance criteria:

```text
[ ] Quality preset changes NAADF budgets.
[ ] Performance100 keeps NAADF conservative.
[ ] Low disables expensive contact queries.
```

### NAADF-090: Add Backend Selection To Radiance Cascades

Goal: let GI choose current SDF or NAADF.

Files:

```text
src/rendering/radiance_cascades.rs
src/rendering/ray_tracing.rs
```

Acceptance criteria:

```text
[ ] GI config mirrors selected voxel backend.
[ ] Backend switch resets GI temporal history.
[ ] Current SDF remains default.
```

### NAADF-091: Add Shader-Side GI Trace Abstraction

Goal: replace direct SDF march calls with a backend function.

Files:

```text
assets/shaders/radiance_cascades.wgsl
assets/shaders/naadf/gi_trace.wgsl
```

WGSL note:

```text
WGSL does not use HLSL-style #if in the same way.
Use separate pipeline variants for performance, or a uniform branch during development.
```

Acceptance criteria:

```text
[ ] GI shader compiles in SDF mode.
[ ] GI shader compiles in NAADF mode.
[ ] Switching backend changes GI trace path.
[ ] Current SDF output remains unchanged when selected.
```

### NAADF-092: Add GI Timing Counters

Goal: make comparison visible in debug and bench output.

Files:

```text
src/rendering/render_timing.rs
src/rendering/naadf/stats.rs
src/rendering/radiance_cascades.rs
```

Counters:

```text
naadf.gpu_memory_bytes
naadf.chunks_resident
naadf.dirty_chunks_pending
naadf.uploaded_chunks_last_frame
naadf.avg_ray_steps_last_frame
naadf.gi_rays_last_frame
```

Acceptance criteria:

```text
[ ] F3 timing table includes NAADF rows.
[ ] Bench CSV includes NAADF counters.
[ ] Summary JSON includes selected backend.
```

### NAADF-093: Add GI A/B Benchmark Scenes

Goal: validate value before preview renderer.

Files:

```text
bench/scenes/visual-regression-naadf-current.toml
bench/scenes/visual-regression-naadf-gi.toml
bench/scenes/visual-regression-naadf-live-lod.toml
bench/scenes/dig-edit-naadf-stability.toml
```

Acceptance criteria:

```text
[ ] Current and NAADF GI bench scenes run.
[ ] Screenshots are captured at fixed frames.
[ ] Bench summary records frame time, GPU pass timing, and NAADF counters.
[ ] Gameplay smoke test can run with NAADF enabled.
```

### NAADF-100: Add Debug Overlay Panel

Goal: make cache state visible.

Files:

```text
src/debug_ui.rs
src/rendering/naadf/debug.rs
src/rendering/naadf/stats.rs
```

Acceptance criteria:

```text
[ ] Debug panel shows backend and mode.
[ ] Debug panel shows dirty queue and memory.
[ ] Debug panel works before GPU path is ready.
```

### NAADF-101: Add Chunk Visualization

Goal: see NAADF chunk cache in the world.

Files:

```text
src/rendering/naadf/debug.rs
```

Acceptance criteria:

```text
[ ] Resident chunks are outlined.
[ ] Dirty chunks are visually distinct.
[ ] Visualization can be toggled.
```

### NAADF-102: Add Ray-Step Heatmap

Goal: identify traversal hot spots.

Files:

```text
assets/shaders/naadf/debug_visualize.wgsl
src/rendering/naadf/debug.rs
```

Acceptance criteria:

```text
[ ] Debug view shows cheap vs expensive rays.
[ ] Heatmap can be captured by visual bench.
[ ] Disabled by default.
```

### NAADF-110: Implement Visible-Region Cache Management

Goal: keep cache around player/camera without thrashing.

Files:

```text
src/rendering/naadf/streaming.rs
src/rendering/naadf/gpu_buffers.rs
```

Acceptance criteria:

```text
[ ] Chunks load around camera/player.
[ ] Chunks evict only outside hysteresis radius.
[ ] Dirty queue receives newly allocated chunks.
[ ] Small movement does not repeatedly allocate/free the same chunks.
```

### NAADF-111: Add Stale-Cache Fallback Policy

Goal: define behavior when edits outrun NAADF rebuild.

Files:

```text
src/rendering/naadf/dirty.rs
src/rendering/ray_tracing.rs
```

Policy:

```text
Requested CurrentSdf -> use CurrentSdf.
Requested Naadf but cache warming/stale -> use CurrentSdf and report fallback.
Requested Auto -> use NAADF only when ready, otherwise CurrentSdf.
```

Acceptance criteria:

```text
[ ] Warming cache falls back to current SDF.
[ ] Dirty queue age beyond threshold falls back to current SDF.
[ ] Overlay reports fallback reason.
```

### NAADF-112: Add Heavy-Edit Stress Bench

Goal: prove digging/sculpting does not leave broken lighting or hitches.

Files:

```text
bench/scenes/dig-edit-naadf-stability.toml
src/bench/mod.rs
```

Acceptance criteria:

```text
[ ] Dirty queue drains after edits.
[ ] No permanent stale lighting after edits.
[ ] No frame-time spike above guard threshold.
```

### NAADF-120: Add Preview Render Mode Pipeline

Goal: create an experimental full-screen NAADF renderer without replacing current renderer.

Files:

```text
src/rendering/naadf/preview.rs
assets/shaders/naadf/first_hit.wgsl
assets/shaders/naadf/preview_composite.wgsl
```

Acceptance criteria:

```text
[ ] Preview mode has separate render graph node.
[ ] Current renderer remains default.
[ ] Preview mode can be selected from settings.
```

### NAADF-121: Port First-Hit Terrain Shader

Goal: render direct voxel hits from NAADF.

Files:

```text
assets/shaders/naadf/first_hit.wgsl
```

Acceptance criteria:

```text
[ ] Preview renders terrain voxels.
[ ] Misses render sky/fog placeholder.
[ ] Materials use approximate terrain palette.
[ ] Water/props are not required yet.
```

### NAADF-122: Add Preview Compositor

Goal: allow full-screen, split-view, or picture-in-picture preview.

Files:

```text
assets/shaders/naadf/preview_composite.wgsl
src/rendering/naadf/preview.rs
```

Acceptance criteria:

```text
[ ] Fullscreen preview works.
[ ] Split view works for comparison.
[ ] Preview mode resets temporal history on enter/exit.
```

### NAADF-130: Add Preview History Buffers

Goal: support temporal accumulation for preview/GI.

Files:

```text
src/rendering/naadf/preview.rs
assets/shaders/naadf/temporal_accumulation.wgsl
```

Acceptance criteria:

```text
[ ] History buffers allocate at preview resolution.
[ ] Backend switch invalidates history.
[ ] Camera cut invalidates history.
[ ] Terrain edit invalidates affected history or full history initially.
```

### NAADF-131: Port Temporal Accumulation Pass

Goal: accumulate noisy preview/GI samples over frames.

Files:

```text
assets/shaders/naadf/temporal_accumulation.wgsl
```

Acceptance criteria:

```text
[ ] Static camera accumulates smoother image.
[ ] Motion does not leave severe ghosting.
[ ] History reset is visible in debug overlay.
```

### NAADF-132: Add Spatial Resampling Pass

Goal: implement spatial denoising/resampling after temporal accumulation.

Files:

```text
assets/shaders/naadf/spatial_resampling.wgsl
```

Acceptance criteria:

```text
[ ] Spatial pass reduces preview noise.
[ ] Edges are not overly blurred.
[ ] Pass can be disabled independently.
```

### NAADF-140: Add Regression Guard Thresholds

Goal: prevent NAADF from silently hurting performance.

Files:

```text
assets/config/bench_guard.toml
src/bin/bench_guard.rs
```

Config shape:

```toml
[naadf]
max_gpu_memory_mb = 512
max_dirty_chunks_pending = 256
max_oldest_dirty_chunk_age_frames = 120
max_avg_ray_steps = 90
max_uploaded_chunks_per_frame = 8
max_frame_time_regression_percent = 10
```

Acceptance criteria:

```text
[ ] bench_guard can fail NAADF regressions.
[ ] Thresholds are configurable.
[ ] Current non-NAADF benches still pass.
```

### NAADF-141: Add Final User/Developer Docs

Goal: make the feature maintainable.

Files:

```text
docs/rendering/naadf.md
docs/rendering/naadf-debugging.md
docs/rendering/naadf-benchmarks.md
```

Acceptance criteria:

```text
[ ] Docs explain how to enable NAADF.
[ ] Docs explain how to run A/B benches.
[ ] Docs explain fallback behavior.
[ ] Docs list known preview limitations.
```

### NAADF-142: Release Gate And Default-Off Policy

Goal: keep the main branch safe.

Files:

```text
src/rendering/naadf/config.rs
assets/config/naadf.yaml
Cargo.toml
README.md
```

Acceptance criteria:

```text
[ ] NAADF disabled by default.
[ ] Feature is opt-in by config/feature flag.
[ ] Current renderer remains the shipping default.
[ ] Integrated GPU fallback is safe.
```

## Hard Gates

Gate A, after NAADF-043:

```text
[ ] CPU NAADF extraction matches Drusniel chunk occupancy.
[ ] CPU NAADF ray hits match current world debug rays on fixtures.
[ ] Dirty queue catches terrain edits and boundary edits.
```

Gate B, after NAADF-063:

```text
[ ] GPU trace matches CPU trace on fixtures.
[ ] Hit/miss parity is stable.
[ ] Hit distance tolerance <= 0.05 voxel units.
[ ] Step count is sane.
```

Gate C, after NAADF-093:

```text
[ ] NAADF GI is faster, more stable, or more scalable than current SDF in at least one important scene.
[ ] No permanent stale-cache lighting after edits.
[ ] Memory remains under configured cap.
[ ] Current SDF fallback is reliable.
```

Gate D, after NAADF-132:

```text
[ ] Preview mode is useful for screenshots/editor/debugging.
[ ] Temporal accumulation improves quality without unacceptable ghosting.
[ ] Preview does not destabilize current renderer.
```

## Dependency Graph

```text
NAADF-000 -> NAADF-001 -> NAADF-002
NAADF-010 -> NAADF-011 -> NAADF-012 -> NAADF-013
NAADF-020 -> NAADF-021 -> NAADF-022 -> NAADF-023 -> NAADF-024
NAADF-030 -> NAADF-031 -> NAADF-032 -> NAADF-033
NAADF-040 -> NAADF-041 -> NAADF-042 -> NAADF-043
NAADF-050 -> NAADF-051 -> NAADF-052 -> NAADF-053
NAADF-060 -> NAADF-061 -> NAADF-062 -> NAADF-063
NAADF-070 -> NAADF-071 -> NAADF-072 -> NAADF-073
NAADF-080 -> NAADF-081 -> NAADF-082
NAADF-090 -> NAADF-091 -> NAADF-092 -> NAADF-093
NAADF-100 -> NAADF-101 -> NAADF-102
NAADF-110 -> NAADF-111 -> NAADF-112
NAADF-120 -> NAADF-121 -> NAADF-122
NAADF-130 -> NAADF-131 -> NAADF-132
NAADF-140 -> NAADF-141 -> NAADF-142
```

## Minimal File Map

```text
src/rendering/
  voxel_ray_backend.rs
  naadf/
    mod.rs
    config.rs
    layout.rs
    cpu_builder.rs
    cpu_trace.rs
    extractor.rs
    dirty.rs
    gpu_buffers.rs
    prepare.rs
    pipeline.rs
    streaming.rs
    debug.rs
    stats.rs
    preview.rs

assets/shaders/naadf/
  common.wgsl
  layout.wgsl
  ray_trace.wgsl
  debug_trace_rays.wgsl
  build_blocks.wgsl
  build_chunks.wgsl
  build_bounds.wgsl
  lighting_queries.wgsl
  gi_trace.wgsl
  first_hit.wgsl
  preview_composite.wgsl
  temporal_accumulation.wgsl
  spatial_resampling.wgsl
  debug_visualize.wgsl

bench/scenes/
  visual-regression-naadf-current.toml
  visual-regression-naadf-gi.toml
  visual-regression-naadf-live-lod.toml
  gameplay-movement-naadf-smoke.toml
  dig-edit-naadf-stability.toml

docs/rendering/
  naadf-port-plan.md
  naadf.md
  naadf-debugging.md
  naadf-benchmarks.md
```

## Release Target

```text
v0.6 experimental:
  Current renderer + optional NAADF GI/shadow/AO backend.

v0.7 experimental:
  NAADF preview renderer + temporal accumulation.

v0.8 decision:
  Decide whether NAADF remains GI backend only or becomes broader terrain-rendering path.
```

Implementation rule:

```text
One authoritative world, one gameplay path, one current renderer, two optional voxel ray backends.
```
