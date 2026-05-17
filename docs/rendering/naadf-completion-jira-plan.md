# NAADF Completion JIRA Plan

Status: implementation in progress  
Last reviewed: 2026-05-15  
Scope: remaining work after CPU voxel/block/chunk skip propagation, CPU skip traversal, GPU upload packing, GPU build dispatch scaffolding, WGSL skip traversal scaffolding, preview GI, preview fog, denoise, dynamic entity-volume upload/traversal, and debug reference path tracing.

## Current Baseline

The local NAADF path now has:

- 16x16x16 Drusniel chunks split into 4x4x4 NAADF blocks and 4x4x4 voxels per block.
- CPU-built per-voxel 2-bit directional skip fields inside each block.
- CPU-built per-block 2-bit directional skip fields inside each chunk.
- CPU-built per-chunk 5-bit directional skip fields across loaded known-empty neighbor chunks.
- Chunk-bound propagation diagnostics for last-frame bound updates, unknown/unloaded neighbor stops, saturated fields, and propagation pass count.
- CPU skip traversal that consumes `voxel_skip` and `directional_skip_blocks`.
- A `NaadfEntityVoxelVolume` component and registry for rotated dynamic voxel volumes, plus CPU ray tracing that selects the nearest terrain/entity hit.
- GPU entity-volume extraction, storage buffers, material upload, and first-hit preview traversal against dynamic voxel volumes.
- GPU upload packing where voxel records carry occupancy plus 12-bit directional skip data, block record word 5 carries per-block skip data, and chunk record word 6 carries per-chunk skip data.
- GPU build shaders for block, voxel, block-bound, and chunk-node record generation.
- GPU chunk-bound shader for safe contiguous loaded-empty chunk skips with bounded perpendicular-slab validation.
- WGSL traversal that reads `naadf_voxel_records`, `naadf_block_records`, and `naadf_chunk_records` and jumps by decoded AADF bounds.
- Radiance cascade shader routing now carries a per-query NAADF mask for GI secondary rays, sun visibility, terrain AO, and contact shadows, while preserving current-SDF fallback when the NAADF shader backend is unavailable. All four Path A query classes are explicit opt-ins; review found the active render-app pass is not yet perf-neutral enough for default promotion.
- A Core3d render graph view node that dispatches NAADF GPU build stages, first-hit preview, and fullscreen preview compositing when preview mode is active.
- First-hit color/depth/normal preview output plus preview fog, fog-tinted miss-sky RGB, a minimal GI estimate, edge-aware spatial filtering, temporal accumulation, low/medium/high multi-pass depth/normal-aware denoise, and an optional debug reference path-trace pass before fullscreen compositing.
- A GPU chunk lookup buffer with sorted `(x, y, z, slot)` records; first-hit preview now walks chunk-space along the ray and binary-searches this table instead of brute-force scanning every valid chunk record.
- Persistent per-view temporal preview history using ping-pong `rgba16float` color textures and `rg16float` moments textures in the render world, with depth-based camera reprojection from first-hit depth and conservative resets when history dimensions or generations change.
- Alpha-preserving preview compositing, so first-hit misses stay transparent over the current scene instead of painting black.
- Non-empty GI, temporal, spatial, denoise, reference path-trace, and preview composite compute entry points.
- Config-backed preview controls for GPU/debug flags, ray steps, bounce count, GI strength, accumulation/blend, opt-in denoise quality, spatial filter radius/sigma, reference path-trace sample count/strength, miss-sky compositing, composite mode, and history scale, with debug UI toggles and last-frame preview pass counters. The history scale can size the NAADF preview/filter/history render targets below full resolution, and fullscreen compositing maps those scaled targets back to scene pixels.

The remaining gaps are:

- GPU chunk-bound construction now has a conservative bounded-slab shader path, but does not yet implement the full upstream queue/propagation solver.
- The preview render graph now allocates, dispatches, and composites a first-hit preview target through a GPU chunk lookup table. This removes the brute-force chunk scan, but it is still a preview renderer rather than the upstream full final renderer.
- Spatial, temporal, and denoise filtering are wired into the preview graph. The temporal path now keeps luminance moments, reprojects history using first-hit depth, and performs variance-based history rejection, but it still lacks per-object motion vectors and production TAA tuning.
- GI is a conservative preview-stage indirect/sky estimate, and the debug reference pass now has configurable deterministic multi-sample screen-space validation, but neither is full upstream path tracing.
- Missing upstream parity stages now center on full queue-based chunk propagation, per-object motion vectors/production TAA tuning, full multi-bounce/reference tracing parity, and visual/benchmark validation.

## Current Ticket Status

| Ticket | Status | Notes |
| --- | --- | --- |
| NAADF-CHUNK-001..004 | Implemented, needs benchmark/visual validation | CPU/GPU records carry chunk skips and traversal consumes voxel/block/chunk skip levels. Chunk-bound diagnostics report updates, unknown-neighbor stops, saturated fields, and passes. GPU chunk bounds use conservative bounded-slab validation rather than full upstream queue propagation. |
| NAADF-GPUBUILD-001..004 | Implemented, needs GPU dispatch/readback validation | GPU build shaders are non-empty and write the fields traversal reads; CPU/shader-mirror parity now covers fixtures, deterministic mixed-material chunks, and water-opacity options, but full GPU dispatch/readback validation remains open. |
| NAADF-PIPE-001..004 | Implemented, needs visual validation | Render graph node, first-hit preview, pass layouts, and composite are wired. |
| NAADF-PIPE-005 | Partially implemented | HUD/fallback, config-backed GPU/debug flags and preview controls including composite mode, preview/history target scale, temporal blend, spatial filter controls, and GI/reference strength controls, debug UI toggles, and per-preview-pass counters exist; deeper editor/runtime command controls can still be expanded. |
| NAADF-FILTER-001..002 | Implemented, needs visual validation | Temporal moments, depth-based history reprojection, variance rejection, and edge-aware spatial filtering are wired. Temporal blend and spatial radius/depth-sigma/normal-sigma are config-backed. |
| NAADF-FILTER-003 | Implemented, needs visual validation | Low/medium/high depth/normal-aware denoise presets run as one, two, or three ping-pong passes after temporal accumulation. Denoise is available as an opt-in preview toggle so the default experimental preview stays within the frame guard. |
| NAADF-GI-001 | Implemented and validated for Path A | Radiance shader backend routing includes per-query masks for GI secondary rays, sun visibility, terrain AO, and contact shadows. Production Path A query coverage has Phase 4-7 visual/perf evidence, and the shader still falls back to current SDF when NAADF is unavailable. |
| NAADF-GI-002 | Implemented for preview and Path A first-bounce GI | A deterministic preview GI compute pass exists with config-backed sky/bounce strengths, and the live radiance-cascade Path A path now casts deterministic NAADF GI-secondary rays. This is still first-bounce Path A lighting-backend coverage, not full upstream multi-bounce final-renderer parity. |
| NAADF-UPSTREAM-001 | Partially implemented | Preview hits consume Drusniel fog uniforms and first-hit misses carry fog-tinted sky RGB through the filter chain behind a default-off composite toggle; cloud/atmosphere parity remains open. |
| NAADF-UPSTREAM-002 | Implemented for CPU and preview GPU path | Dynamic voxel volumes have CPU tracing, GPU upload, and first-hit preview traversal. |
| NAADF-UPSTREAM-003 | Partially implemented | A debug/off-by-default reference path-trace pass is wired with configurable deterministic 1..32 sample screen-space validation and strength controls; full upstream-quality reference tracing still needs true secondary rays and visual validation. |

## Delivery Strategy

Do not attempt a single "full NAADF" merge. Land the work behind the existing disabled-by-default NAADF feature path in small gates:

1. Chunk-level AADF correctness.
2. GPU build parity with CPU records.
3. First visible NAADF preview pixel.
4. Production preview pipeline and debug controls.
5. Temporal/spatial filtering.
6. Optional upstream parity extensions: atmosphere, entities, advanced GI, and denoise.

Every ticket that can affect rendering performance must be verified with the project bench workflow before claiming a performance result.

## Epic NAADF-CHUNK: Chunk-Level AADF Propagation

### NAADF-CHUNK-001: Define Chunk-Level AADF Record Format

Type: Story  
Priority: P0  
Depends on: current CPU voxel/block skip format  
Target files:

```text
src/rendering/naadf/layout.rs
src/rendering/naadf/gpu_buffers.rs
assets/shaders/naadf/common.wgsl
assets/shaders/naadf/ray_trace.wgsl
```

Goal:

Define how chunk-level directional skips are stored and consumed. Upstream stores chunk-scale bounds in chunk node bits with wider fields than the 2-bit voxel/block fields. Drusniel needs a stable equivalent before traversal can skip across chunk boundaries.

Implementation notes:

- Add a `PackedDirectionalBounds5Bit` or equivalent type for chunk-level bounds if matching upstream's 0..31 range.
- Keep the existing 2-bit `PackedDirectionalBounds2Bit` for voxel and block levels.
- Decide whether chunk bounds live in `NaadfChunk::node`, a new chunk record word, or a parallel chunk bounds field.
- Preserve backward-compatible buffer sizes only if possible. If chunk record layout changes, update `NAADF_PACKED_CHUNK_WORDS` tests and shader constants together.
- Document the bit layout next to both Rust and WGSL constants.

Acceptance criteria:

- Rust and WGSL constants agree on chunk bounds offsets and masks.
- CPU chunk records can represent at least 31 empty chunks in each axis direction, matching upstream's practical field width.
- Existing CPU layout tests still pass.
- New unit tests prove min/max encoded values round-trip.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::layout --lib
rtk cargo test --features naadf rendering::naadf::gpu_buffers --lib
```

### NAADF-CHUNK-002: Track Chunk Occupancy State For Propagation

Type: Story  
Priority: P0  
Depends on: NAADF-CHUNK-001  
Target files:

```text
src/rendering/naadf/cache.rs
src/rendering/naadf/layout.rs
src/rendering/naadf/streaming.rs
src/rendering/naadf/systems.rs
```

Goal:

Expose enough loaded-neighbor state to compute chunk-level AADF bounds without treating missing chunks as known empty terrain.

Implementation notes:

- Define three states for propagation inputs: known empty, known occupied or mixed, and unknown or unloaded.
- Treat unknown chunks as blocking for safety unless an explicit streaming policy proves otherwise.
- Store chunk-level state in `NaadfCache` or a derived propagation view, not in `VoxelWorld`.
- Include stale/dirty chunks in propagation invalidation. A chunk's bounds depend on neighboring chunk states along the six axes.

Acceptance criteria:

- A loaded empty chunk adjacent to an unloaded chunk does not skip through the unloaded chunk.
- A loaded empty chunk adjacent to a loaded occupied chunk stops before the occupied chunk.
- Dirtying a chunk queues neighboring chunk-bound updates.
- Tests cover loaded empty, loaded full, mixed, and unloaded neighbors.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::cache --lib
rtk cargo test --features naadf rendering::naadf::streaming --lib
```

### NAADF-CHUNK-003: Implement CPU Chunk-Level Propagation

Type: Story  
Priority: P0  
Depends on: NAADF-CHUNK-001, NAADF-CHUNK-002  
Target files:

```text
src/rendering/naadf/cpu_builder.rs
src/rendering/naadf/cache.rs
tests/fixtures/naadf/*.ron
tests/naadf_cpu_layout.rs
```

Goal:

Port upstream-style chunk-level bounds propagation so CPU traversal can skip across known-empty chunks safely.

Implementation notes:

- Reuse the phase-ordered propagation pattern already used for voxel/block 4-cubes where applicable.
- For multi-chunk propagation, use queue-based expansion similar to upstream `boundsCalc.fx` rather than assuming a single 4x4x4 volume.
- Clamp fields to the selected chunk bound range.
- Unknown or unloaded chunk states must terminate propagation.
- Record counters for propagation work: queued chunks, updated chunk bounds, skipped unknown neighbors, and saturated bounds. CPU/cache-side last-frame counters are implemented; GPU dispatch/readback counters still need runtime validation.

Acceptance criteria:

- CPU tracer can skip across multiple loaded empty chunks and still hit the first occupied chunk.
- CPU tracer never skips into unloaded space unless explicitly configured.
- Random multi-chunk DDA equivalence tests pass for hits and misses.
- Step-count tests show chunk-level skip improves over block-only skip on sparse multi-chunk fixtures.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::cpu --lib
rtk cargo test --features naadf --test naadf_cpu_layout
```

### NAADF-CHUNK-004: Consume Chunk-Level Bounds In CPU And WGSL Traversal

Type: Story  
Priority: P0  
Depends on: NAADF-CHUNK-003  
Target files:

```text
src/rendering/naadf/cpu_trace.rs
assets/shaders/naadf/ray_trace.wgsl
src/rendering/naadf/gpu_tests.rs
```

Goal:

Update traversal to select the deepest safe skip level: chunk for uniform empty chunks, block for uniform empty blocks, and voxel for mixed blocks.

Implementation notes:

- Mirror upstream behavior: if the current node is chunk-level empty, use chunk bounds; if it descends into an empty block, use block bounds; otherwise use voxel bounds.
- Keep CPU and WGSL branch structure intentionally similar to simplify parity review.
- Preserve the current dense fallback for diagnostics if useful, but do not route production NAADF through dense stepping.

Acceptance criteria:

- CPU and WGSL helper tests prove chunk, block, and voxel skip decoding use the same sign-dependent offsets.
- CPU DDA equivalence tests cover rays entering from outside loaded bounds.
- GPU debug trace outputs match CPU for multi-chunk fixtures once GPU dispatch exists.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::cpu_trace --lib
rtk cargo test --features naadf rendering::naadf::gpu_tests --lib
```

## Epic NAADF-GPUBUILD: GPU Build Parity

### NAADF-GPUBUILD-001: Update GPU Record Layout To Match CPU Upload

Type: Story  
Priority: P0  
Depends on: NAADF-CHUNK-001  
Target files:

```text
assets/shaders/naadf/common.wgsl
assets/shaders/naadf/build_blocks.wgsl
assets/shaders/naadf/build_bounds.wgsl
src/rendering/naadf/gpu_buffers.rs
src/rendering/naadf/layout.rs
```

Goal:

Make GPU-generated records byte-for-byte compatible with CPU-generated records.

Implementation notes:

- `build_blocks.wgsl` currently writes zero to block record word 5. It must write the same per-block skip field CPU upload writes.
- `build_bounds.wgsl` currently writes coarse AABB shrink values, not the current 2-bit propagation fields. Decide whether to replace it or split it into `build_aabb_bounds` and `build_aadf_bounds`.
- Add comments in WGSL for each block word and voxel word.

Acceptance criteria:

- CPU and WGSL record layouts are documented in one table.
- `build_blocks.wgsl` no longer writes placeholder zeroes for fields that production traversal reads.
- Tests detect if CPU and GPU record field offsets drift.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::layout --lib
rtk cargo test --features naadf rendering::naadf::gpu_buffers --lib
```

### NAADF-GPUBUILD-002: Implement GPU Voxel Bounds Build

Type: Story  
Priority: P1  
Depends on: NAADF-GPUBUILD-001  
Target files:

```text
assets/shaders/naadf/build_blocks.wgsl
assets/shaders/naadf/build_bounds.wgsl
src/rendering/naadf/prepare.rs
src/rendering/naadf/pipeline.rs
```

Goal:

Compute per-voxel directional 2-bit bounds on GPU using the same phase-ordered propagation as CPU.

Implementation notes:

- Use a 64-thread workgroup and `workgroup` memory to mirror upstream `ComputeBounds4`.
- Sync after X, Y, and Z phases inside each outer pass.
- Preserve raw voxel material payloads separately from AADF skip data.
- Avoid read/write races by using workgroup-local cached records and a single writeback pass.

Acceptance criteria:

- Shader body is non-empty and writes per-voxel AADF fields.
- CPU fixture generated records and GPU readback records match for empty, full, wall, tunnel, and sparse chunks.
- Integrated GPU fallback remains disabled by default.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::gpu_tests --lib
```

### NAADF-GPUBUILD-003: Implement GPU Block And Chunk Bounds Build

Type: Story  
Priority: P1  
Depends on: NAADF-GPUBUILD-002, NAADF-CHUNK-003  
Target files:

```text
assets/shaders/naadf/build_bounds.wgsl
assets/shaders/naadf/build_chunks.wgsl
src/rendering/naadf/prepare.rs
src/rendering/naadf/gpu_buffers.rs
```

Goal:

Generate block-level and chunk-level bounds on GPU so CPU upload is no longer the only correct build path.

Implementation notes:

- Block-level build can use 64-thread chunk-local workgroups.
- Chunk-level build likely needs a queue or multi-dispatch propagation pass, similar to upstream `boundsCalc.fx`.
- Keep a CPU-built fallback until GPU parity is proven.
- Surface GPU build queue age and stale-cache reasons in `NaadfStats`.

Acceptance criteria:

- GPU-generated block skip word 5 matches CPU for all fixture chunks.
- GPU-generated chunk bounds match CPU for multi-chunk fixtures.
- Stale GPU build queues force fallback to current SDF or CPU-built NAADF rather than using invalid bounds.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::gpu_tests --lib
rtk cargo test --features naadf --test naadf_cpu_layout
```

### NAADF-GPUBUILD-004: Add CPU vs GPU Record Equivalence Harness

Type: Story  
Priority: P1  
Depends on: NAADF-GPUBUILD-003  
Target files:

```text
src/rendering/naadf/gpu_tests.rs
tests/fixtures/naadf/*.ron
tests/naadf_gpu_layout.rs
```

Goal:

Make layout drift obvious by comparing CPU-built records against GPU-built records.

Implementation notes:

- Add a test-only GPU harness if the repo already has a headless wgpu test pattern. If not, create a CPU mirror of WGSL packing first and leave GPU readback as an ignored/manual test.
- Compare chunk records, block records, voxel records, material records, and raw voxel records.
- Record exact mismatch location and field name.

Acceptance criteria:

- Test failure reports record kind, chunk position, local coordinate or block index, expected value, and actual value.
- Fixture coverage includes empty, full, sparse, wall, tunnel, diagonal, and chunk-boundary cases.
- The harness can be run locally without launching the editor.

Verification:

```powershell
rtk cargo test --features naadf --test naadf_gpu_layout
```

## Epic NAADF-PIPE: Production Pipeline And Render Graph

### NAADF-PIPE-001: Design Render Resource Bind Group Layouts

Type: Story  
Priority: P0  
Depends on: NAADF-GPUBUILD-001  
Target files:

```text
src/rendering/naadf/pipeline.rs
src/rendering/naadf/gpu_buffers.rs
assets/shaders/naadf/*.wgsl
```

Goal:

Define the bind group layouts needed by first-hit, GI, debug trace, temporal, spatial, and composite passes.

Implementation notes:

- Do not reuse group 3 casually across unrelated pipelines unless the layouts are identical.
- Separate stable world data buffers from per-view uniforms and per-pass textures.
- Include chunk table indirection if rays need to map world chunk coordinates to GPU slots.
- Include stats/debug buffers only when diagnostics are enabled.

Acceptance criteria:

- `pipeline.rs` owns bind group layout creation through `FromWorld` or equivalent render-world initialization.
- WGSL binding declarations match Rust layouts.
- Missing optional buffers are handled by fallback dummy resources.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::naadf::layout --lib
```

### NAADF-PIPE-002: Implement First-Hit Preview Compute Pipeline

Type: Story  
Priority: P0  
Depends on: NAADF-PIPE-001, NAADF-GPUBUILD-001  
Target files:

```text
src/rendering/naadf/pipeline.rs
src/rendering/naadf/preview.rs
assets/shaders/naadf/first_hit.wgsl
assets/shaders/naadf/ray_trace.wgsl
```

Goal:

Produce a first visible NAADF preview texture from uploaded NAADF records. No GI, denoise, or temporal history yet.

Implementation notes:

- Dispatch one ray per preview pixel.
- Use camera/view uniforms already available in the render world where possible.
- Output color, hit distance, normal, material id, and step count to debug-friendly textures or buffers.
- Keep a low default preview resolution until performance is measured.

Acceptance criteria:

- `NaadfPreview` mode creates a non-empty preview texture.
- First-hit output matches CPU ray expectations for a fixed camera fixture.
- The current renderer remains visible in `Current` and `CurrentWithNaadfGi` modes.
- Failure to allocate preview resources falls back cleanly with a visible diagnostic reason.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-PIPE-003: Add Render Graph Node For NAADF Preview

Type: Story  
Priority: P0  
Depends on: NAADF-PIPE-002  
Target files:

```text
src/rendering/naadf/mod.rs
src/rendering/naadf/pipeline.rs
src/rendering/naadf/preview.rs
src/rendering/plugin.rs
```

Goal:

Wire the preview pipeline into Bevy's render graph so it dispatches per frame when `ExperimentalRenderMode::NaadfPreview` is active.

Implementation notes:

- Register a real graph node for `NaadfPreviewNodeLabel`.
- Ensure node ordering has access to camera/view resources and writes before composite.
- Gate dispatch on config, feature availability, cache readiness, and resource allocation.
- Add render timing rows for preview build, first-hit dispatch, and composite.

Acceptance criteria:

- `NaadfPreviewNodeLabel` is no longer dead.
- Dispatch count is visible in stats.
- Preview node does not run in current renderer mode.
- Render timing capture includes NAADF preview rows when enabled.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-PIPE-004: Implement Preview Composite Pass

Type: Story  
Priority: P1  
Depends on: NAADF-PIPE-003  
Target files:

```text
assets/shaders/naadf/preview_composite.wgsl
src/rendering/naadf/preview.rs
src/rendering/naadf/pipeline.rs
```

Goal:

Replace the empty `naadf_preview_composite` entry point with an actual pass that composites the NAADF preview into fullscreen, split-view, or picture-in-picture modes.

Implementation notes:

- Reuse `naadf_preview_composite_color` but call it from the compute entry point.
- Bind current color, preview color, output target, and composite params.
- Keep modes deterministic for visual regression screenshots.
- Avoid in-app explanatory text. Use debug UI/state only.

Acceptance criteria:

- Fullscreen, split-view, and picture-in-picture composite modes all render.
- Output is non-black when first-hit preview has hits.
- Composite mode changes do not require rebuilding NAADF buffers.
- Visual regression screenshots show expected preview placement.

Verification:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-PIPE-005: Add Runtime Controls And Diagnostics

Type: Story  
Priority: P1  
Depends on: NAADF-PIPE-003  
Target files:

```text
src/rendering/ray_tracing.rs
src/rendering/naadf/stats.rs
src/runtime_commands.rs
editor/frontend/*
```

Goal:

Expose enough diagnostics to operate the preview path safely in the editor and benches.

Implementation notes:

- Add counters for cache state, GPU slot use, build queue age, uploaded chunks, first-hit dispatches, average ray steps, and fallback reason.
- Expose runtime commands for comparing CPU and GPU rays at selected pixels.
- Keep heavy diagnostics behind `DRUSNIEL_EDITOR_DIAGNOSTICS=1` or NAADF debug config.

Acceptance criteria:

- User can see whether NAADF is disabled, warming, stale, ready, or falling back.
- Runtime commands can compare selected CPU/GPU rays.
- Editor restart/rebuild workflow is documented if editor UI is touched.

Verification:

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::naadf --lib
```

## Epic NAADF-FILTER: Temporal, Spatial, And Denoise Passes

### NAADF-FILTER-001: Implement Temporal Accumulation Entry Point

Type: Story  
Priority: P2  
Depends on: NAADF-PIPE-002  
Target files:

```text
assets/shaders/naadf/temporal_accumulation.wgsl
src/rendering/naadf/preview.rs
src/rendering/naadf/pipeline.rs
```

Goal:

Replace the empty temporal entry point with history accumulation for preview/GI samples.

Implementation notes:

- Start with color history and reset-on-camera-cut/backend-switch.
- Add motion/depth validation only after first-hit depth and normal outputs are stable.
- Use the existing `NaadfPreviewHistoryPlan` as the allocation source.

Acceptance criteria:

- History resets on backend switch.
- Static camera converges over multiple frames.
- Moving camera does not smear obvious stale samples.
- Bench screenshots do not show ghosting worse than current renderer baseline.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf::preview --lib
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-FILTER-002: Implement Spatial Resampling Entry Point

Type: Story  
Priority: P2  
Depends on: NAADF-FILTER-001  
Target files:

```text
assets/shaders/naadf/spatial_resampling.wgsl
src/rendering/naadf/pipeline.rs
```

Goal:

Replace the empty spatial entry point with edge-aware spatial filtering.

Implementation notes:

- Use color, depth, normal, and material id to avoid bleeding across edges.
- Start with a small fixed radius.
- Expose radius and sigma values through NAADF config, but keep conservative defaults.

Acceptance criteria:

- Spatial pass reduces preview noise without blurring voxel edges beyond the configured tolerance.
- Disabling spatial resampling produces the unfiltered preview.
- Timing rows show pass cost separately.

Verification:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-FILTER-003: Add Denoise Split / A-Trous Equivalent

Type: Story  
Priority: P3  
Depends on: NAADF-FILTER-002  
Target files:

```text
assets/shaders/naadf/denoise.wgsl
src/rendering/naadf/pipeline.rs
src/rendering/naadf/preview.rs
```

Goal:

Add a denoise pass equivalent to upstream's denoise stage where it improves visual stability beyond temporal/spatial resampling.

Implementation notes:

- Create a new shader file rather than overloading `spatial_resampling.wgsl`.
- Use ping-pong textures for multi-iteration filtering.
- Make pass count quality-controlled.

Acceptance criteria:

- Denoise can be disabled independently.
- Low/medium/high quality presets map to known pass counts.
- Visual regression captures show no unacceptable edge bleeding.

Verification:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Epic NAADF-GI: Integrate NAADF With Lighting Queries

### NAADF-GI-001: Route Current GI Queries Through Backend Abstraction

Type: Story  
Priority: P1  
Depends on: NAADF-PIPE-002  
Target files:

```text
src/rendering/radiance_cascades.rs
assets/shaders/radiance_cascades.wgsl
assets/shaders/naadf/lighting_queries.wgsl
```

Goal:

Use NAADF traversal for selected GI, sun visibility, terrain AO, or contact shadow queries while keeping current SDF fallback.

Implementation notes:

- Start with one query class, preferably debug sun visibility or terrain AO, not every query at once.
- Preserve current SDF backend as default and fallback.
- Add query-purpose counters so performance data can be attributed.

Acceptance criteria:

- Backend selection is controlled by `RayTracingSettings`.
- NAADF cache warming/stale states fall back to current SDF.
- Results are comparable against current path in fixed bench scenes.

Verification:

```powershell
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-GI-002: Implement Minimal GI Trace Pass

Type: Story  
Priority: P2  
Depends on: NAADF-GI-001, NAADF-FILTER-001  
Target files:

```text
assets/shaders/naadf/gi_trace.wgsl
src/rendering/naadf/pipeline.rs
src/rendering/naadf/preview.rs
```

Goal:

Move beyond first-hit preview by tracing secondary rays for a minimal indirect lighting estimate.

Implementation notes:

- Keep the first implementation deterministic for testability.
- Use a low ray count and fixed seed in bench mode.
- Accumulate through the temporal pass.

Acceptance criteria:

- GI pass can be toggled independently from first-hit preview.
- Indirect contribution is visible in controlled fixtures.
- Timing and ray count counters are reported.

Verification:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

## Epic NAADF-UPSTREAM: Optional Upstream Parity Extensions

### NAADF-UPSTREAM-001: Atmosphere And Sky Integration

Type: Story  
Priority: P3  
Depends on: NAADF-PIPE-004  
Target files:

```text
assets/shaders/naadf/atmosphere.wgsl
src/rendering/naadf/pipeline.rs
src/rendering/volumetric_clouds.rs
```

Goal:

Integrate preview rays with Drusniel sky/fog/atmosphere rather than flat material colors.

Implementation notes:

- Prefer reusing existing Drusniel sky/fog/cloud data over directly copying upstream atmosphere files.
- Keep atmosphere outside the critical path for first-hit correctness.

Acceptance criteria:

- Miss rays show appropriate sky/fog color.
- Hit rays receive lighting consistent with current scene sun direction.
- Visual regression screenshots do not regress current non-NAADF renderer.

Verification:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression.toml
```

### NAADF-UPSTREAM-002: Entity And Dynamic Voxel Support

Type: Story  
Priority: P3  
Depends on: NAADF-PIPE-002  
Target files:

```text
src/rendering/naadf/entities.rs
assets/shaders/naadf/entities.wgsl
assets/shaders/naadf/ray_trace.wgsl
```

Goal:

Add upstream-style dynamic entity voxel volumes only if Drusniel gameplay needs NAADF ray hits against dynamic voxel objects.

Implementation notes:

- Do not block static terrain preview or GI on this work.
- Define separate entity buffers and transforms.
- Ray traversal should test entity AABBs and transform rays into entity-local space.

Acceptance criteria:

- Static terrain NAADF remains unchanged when no entity volumes exist.
- Entity rays match CPU reference for translation, rotation, and scale fixtures.
- Entity buffers are optional and disabled by default.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf --lib
```

### NAADF-UPSTREAM-003: Path Tracer Reference Variant

Type: Story  
Priority: P4  
Depends on: NAADF-GI-002  
Target files:

```text
assets/shaders/naadf/path_trace.wgsl
src/rendering/naadf/pipeline.rs
```

Goal:

Add a slow reference path tracing mode for validating GI and denoise quality.

Implementation notes:

- Keep this debug-only and never default.
- Use fixed seeds in bench mode for reproducibility.
- Store output separately from production preview.

Acceptance criteria:

- Reference mode can compare against production GI on fixed scenes.
- It is excluded from normal quality presets.
- Runtime diagnostics clearly mark it as debug/reference.

Verification:

```powershell
rtk cargo check --features naadf
```

## Epic NAADF-VERIFY: Benchmarks, Regression Gates, And Release Criteria

### NAADF-VERIFY-001: Add NAADF Bench Scenes

Type: Story  
Priority: P1  
Depends on: NAADF-PIPE-003  
Target files:

```text
bench/scenes/visual-regression-naadf-preview.toml
bench/scenes/visual-regression-naadf-gi.toml
src/bench/*
```

Goal:

Create reproducible benches for preview and GI modes.

Implementation notes:

- Include a sparse multi-chunk scene that benefits from chunk-level skip.
- Include a dense scene where NAADF may not help, to catch overhead regressions.
- Include fixed screenshots for visual inspection.

Acceptance criteria:

- Benches produce `summary.json`, timing rows, counters, and screenshots.
- Bench config explicitly selects backend and mode.
- Bench runs do not require editor UI.

Verification:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual-regression-naadf-preview.toml
```

### NAADF-VERIFY-002: Add Bench Guard Metrics

Type: Story  
Priority: P1  
Depends on: NAADF-VERIFY-001  
Target files:

```text
src/bin/bench_guard.rs
bench/baselines/*
```

Goal:

Fail obvious NAADF regressions in frame time, build queue staleness, upload size, and ray step counts.

Implementation notes:

- Do not sum broad parent/child timing rows.
- Track specific rows: NAADF cache rebuild, GPU upload, first-hit dispatch, composite, temporal, spatial, and total frame.
- Track counters: average ray steps, max ray steps, uploaded chunks, stale queue age, GPU memory bytes.

Acceptance criteria:

- `bench_guard` reports which NAADF row or counter regressed.
- Guard can distinguish expected warm-up from steady-state regression.
- Guard does not run NAADF checks for non-NAADF benches unless configured.

Verification:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

### NAADF-VERIFY-003: Define Experimental Release Gate

Type: Task  
Priority: P0  
Depends on: NAADF-VERIFY-001, NAADF-VERIFY-002  
Target files:

```text
docs/rendering/naadf-release-gate.md
docs/rendering/naadf-completion-jira-plan.md
```

Goal:

Define the minimum evidence required before NAADF can move from scaffold/experimental to supported experimental mode.

Acceptance criteria:

- CPU/GPU parity tests pass.
- Preview renders non-empty screenshots.
- Current renderer remains default.
- Integrated GPU fallback is tested.
- Release bench has before/after summary comparison.
- Known visual regressions are documented or fixed.

Verification:

```powershell
rtk cargo test --features naadf rendering::naadf --lib
rtk cargo run --release -- --bench bench/scenes/visual-regression-naadf-preview.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Suggested Execution Order

1. NAADF-CHUNK-001
2. NAADF-CHUNK-002
3. NAADF-CHUNK-003
4. NAADF-CHUNK-004
5. NAADF-GPUBUILD-001
6. NAADF-GPUBUILD-002
7. NAADF-GPUBUILD-003
8. NAADF-GPUBUILD-004
9. NAADF-PIPE-001
10. NAADF-PIPE-002
11. NAADF-PIPE-003
12. NAADF-PIPE-004
13. NAADF-VERIFY-001
14. NAADF-VERIFY-002
15. NAADF-GI-001
16. NAADF-FILTER-001
17. NAADF-FILTER-002
18. NAADF-GI-002
19. NAADF-FILTER-003
20. NAADF-UPSTREAM-001
21. NAADF-UPSTREAM-002
22. NAADF-UPSTREAM-003
23. NAADF-VERIFY-003

## Open Design Decisions

- Should chunk-level bounds be encoded into `chunk_record[0]` like upstream, or should Drusniel keep a separate explicit word for readability and safer evolution?
- Should GPU build become the source of truth, or should CPU build remain authoritative with GPU build as an optimization?
- Should `NaadfPreview` composite into the main camera target or a separate debug viewport texture first?
- Which lighting query should be the first production NAADF consumer: sun visibility, terrain AO, contact shadows, or GI probes?
- How should unloaded chunks be represented in preview mode: hard miss, current renderer fallback, or debug color?

## Non-Goals For This Backlog

- Making NAADF the default renderer.
- Removing current SDF GI fallback.
- Replacing Surface Nets, blocky terrain, water, props, weather, fog, or PBR materials.
- Claiming performance improvements before release bench comparisons exist.
