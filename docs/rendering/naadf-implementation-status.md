# NAADF Implementation Status

Status: implementation record with current caveats  
Branch/worktree: `main`  
Last updated: 2026-05-18 (NAADF-230 Path-B C1 compositor landed; lighting visual A/B bench not rerun in this batch)  
Visual verification: preview-only, Path-B hybrid, Path-B DepthAudit, and startup-stability fixed screenshots inspected for the 2026-05-18 bench runs listed below; lighting Path A visual evidence remains the earlier Path A bench set documented under `docs/rendering/naadf-path-a/`

This file records what has been implemented from the NAADF plan so the remaining work can continue Jira-by-Jira without losing track of the completed foundation.

## Completed

### NAADF-000: Port Plan And Risk Register

Added:

- `docs/rendering/naadf-port-plan.md`
- `docs/rendering/naadf-risk-register.md`

Details:

- Documents that `VoxelWorld` remains authoritative.
- Documents NAADF as a derived voxel ray-query/GI cache, not a renderer replacement.
- Lists NAADF shader source-to-target port files.
- Lists local Drusniel modules touched by the first implementation pass.
- Defines CPU parity, GPU parity, and GI benchmark gates.
- Captures key risks: packed traversal correctness, dirty chunk drift, memory pressure, water mismatch, renderer scope creep, and benchmark ambiguity.

### NAADF-001: Feature Flags And Module Skeleton

Updated:

- `Cargo.toml`
- `src/rendering/mod.rs`
- `src/rendering/plugin.rs`

Added:

- `src/rendering/voxel_ray_backend.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/config.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/stats.rs`
- `src/rendering/naadf/cpu_builder.rs`
- `src/rendering/naadf/cpu_trace.rs`
- `src/rendering/naadf/debug.rs`
- `src/rendering/naadf/dirty.rs`
- `src/rendering/naadf/extractor.rs`
- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/prepare.rs`
- `src/rendering/naadf/preview.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added `naadf` and `naadf_debug` Cargo features.
- Added `#[cfg(feature = "naadf")] pub mod naadf`.
- Registered the NAADF plugin only when the `naadf` feature is enabled.
- Added a no-op plugin path when the feature is disabled so current runtime behavior remains unchanged.
- Added resource scaffolding for config, dirty queue, stats, cache state, and preview settings.

### NAADF-002: Fixture List And Golden Scenes

Added:

- `tests/fixtures/naadf/empty_chunk.ron`
- `tests/fixtures/naadf/full_chunk.ron`
- `tests/fixtures/naadf/single_voxel.ron`
- `tests/fixtures/naadf/wall_x.ron`
- `tests/fixtures/naadf/wall_y.ron`
- `tests/fixtures/naadf/wall_z.ron`
- `tests/fixtures/naadf/staircase.ron`
- `tests/fixtures/naadf/tunnel.ron`
- `tests/fixtures/naadf/chunk_boundary.ron`
- `tests/fixtures/naadf/bedrock_floor.ron`

Details:

- Fixtures cover empty, full, sparse, wall, staircase, tunnel, boundary, and bedrock-floor cases.
- Fixtures document expected rays and expected hit or miss results.
- `tests/naadf_cpu_layout.rs` loads all RON fixtures and validates expected CPU NAADF ray hits.

### NAADF-010: RayTracingSettings Backend State

Updated:

- `src/rendering/ray_tracing.rs`
- `src/runtime_commands.rs`

Details:

- Added `VoxelRayBackendMode` with `CurrentSdf`, `Naadf`, and `Auto`.
- Added `ExperimentalRenderMode` with `Current`, `CurrentWithNaadfGi`, and `NaadfPreview`.
- Expanded `RayTracingSettings` with:
  - `voxel_backend`
  - `experimental_mode`
  - `allow_naadf_on_integrated_gpu`
  - `reset_history_on_backend_switch`
  - `backend_switch_generation`
  - `fallback_reason`
- Defaults preserve the current renderer and current SDF path.
- Runtime metrics now expose selected/effective voxel backend, experimental mode, backend switch generation, and fallback reason.
- Existing `enabled` behavior is preserved when runtime commands toggle ray tracing.

### NAADF-011: F11 Backend Toggle

Updated:

- `src/rendering/ray_tracing.rs`
- `src/rendering/plugin.rs`
- `src/debug_ui.rs`

Details:

- Added F11 cycling:
  - `CurrentSdf -> Naadf -> Auto -> CurrentSdf`
- The hotkey changes only runtime state.
- No buffer rebuild is triggered directly from input.
- Integrated GPUs block `Naadf` unless `allow_naadf_on_integrated_gpu` is true.
- Backend switches increment `backend_switch_generation` when history reset is enabled.
- Debug settings UI shows selected backend, render mode, fallback reason, and the F11 hint.

### NAADF-012: Config Keys

Added:

- `assets/config/naadf.yaml`
- `src/rendering/naadf/config.rs`

Details:

- Added disabled-by-default NAADF YAML config.
- Added config fields for:
  - enable/disable
  - visible-chunk-only builds
  - cache radius and hysteresis
  - max chunks
  - max chunk updates per frame
  - max upload bytes per frame
  - max GPU memory
  - integrated GPU override
  - GPU builder preference
  - debug readback
  - chunk/ray/AADF debug visualization
  - CPU/GPU compare
  - CPU/GPU builder forcing
  - sun visibility, terrain AO, and contact shadow feature toggles
- Added `NaadfConfig::load_or_default`.

### NAADF-013: Bench Render Toggles

Updated:

- `src/bench/mod.rs`

Added:

- `bench/scenes/naadf/visual-regression-naadf-current.toml`
- `bench/scenes/naadf/visual-regression-naadf-gi.toml`
- `bench/scenes/naadf/visual-regression-naadf-preview.toml`
- `bench/scenes/naadf/gameplay-movement-naadf-smoke.toml`
- `bench/scenes/naadf/dig-edit-naadf-stability.toml`

Details:

- Added bench toggle fields:
  - `voxel_ray_backend`
  - `experimental_render_mode`
  - `naadf_force_cpu_builder`
  - `naadf_force_gpu_builder`
  - `naadf_max_chunk_updates_per_frame`
- Bench summaries now include the selected render toggles.
- Bench runtime applies voxel backend and experimental render mode settings.
- With `naadf` feature enabled, bench runtime can apply CPU/GPU builder force flags and chunk-update budget overrides.
- Bench scenes are present but have not been executed.

### NAADF-020: Layout Constants

Added:

- `src/rendering/naadf/layout.rs`

Details:

- Added constants:
  - `VOXELS_PER_BLOCK_AXIS = 4`
  - `BLOCKS_PER_CHUNK_AXIS = 4`
  - `VOXELS_PER_CHUNK_AXIS = 16`
  - `VOXELS_PER_BLOCK = 64`
  - `BLOCKS_PER_CHUNK = 64`
  - `VOXELS_PER_CHUNK = 4096`
- Added indexing helpers:
  - `voxel_index_in_chunk`
  - `block_index_in_chunk`
  - `voxel_index_in_block`
  - `block_coord_for_voxel`
  - `local_coord_in_block`
  - `chunk_world_origin`
- Unit tests verify boundary indexing matches `Chunk::index()`.

### NAADF-021: Packed CPU Records

Added:

- `PackedNaadfNode`
- `NaadfNodeState`
- `DirectionalBounds`
- `NaadfBlock`
- `NaadfChunk`

Details:

- Top two bits of `PackedNaadfNode` encode node state.
- Payload uses the lower 30 bits.
- Node states support `UniformEmpty`, `UniformFull`, `Children`, and `Reserved`.
- Tests cover state/payload round trips.

### NAADF-022: Build CPU NAADF Chunk From Chunk

Added:

- `src/rendering/naadf/cpu_builder.rs`

Details:

- Converts a Drusniel `Chunk` into `NaadfChunk`.
- Builds chunk occupancy and stable material IDs.
- Builds 64 block records per chunk.
- Empty chunks become `UniformEmpty`.
- Full solid chunks become `UniformFull`.
- Mixed chunks become `Children`.
- Water is not opaque by default in the NAADF builder.

### NAADF-023: Compute Directional Bounds On CPU

Added:

- `compute_directional_bounds`
- `DirectionalBounds::empty_block`
- `DirectionalBounds::full_block`

Details:

- Empty block returns 4 for all six directions.
- Full block returns 0 for all six directions.
- Single voxel at block-local `(0, 0, 0)` returns:
  - `neg_x = 0`
  - `pos_x = 3`
  - `neg_y = 0`
  - `pos_y = 3`
  - `neg_z = 0`
  - `pos_z = 3`

### NAADF-024: CPU Layout Unit Tests

Added:

- `tests/naadf_cpu_layout.rs`

Details:

- Feature-gated under `naadf`.
- Tests layout constants.
- Tests full-chunk uniform build.
- Tests mixed chunk material stability.
- Tests water transparency behavior.
- Tests directional bounds.
- Tests CPU ray traversal across a chunk boundary.
- Loads every golden RON fixture and validates expected hit/miss results through the CPU NAADF ray backend.

### NAADF-030: Chunk Extractor

Added:

- `src/rendering/naadf/extractor.rs`

Details:

- Added `NaadfChunkExtractor`.
- Extracts a single loaded chunk from `VoxelWorld`.
- Extracts all loaded chunks.
- Missing chunks return `NaadfExtractionError::MissingChunk` instead of being converted to empty chunks.
- No render-world dependency.

### NAADF-031: Dirty Queue

Added:

- `src/rendering/naadf/dirty.rs`

Details:

- Added `NaadfDirtyChunkQueue`.
- Queue de-duplicates pending and in-flight chunk positions.
- Tracks pending, in-flight, and total queued count.
- Added queue stats for diagnostics.
- Current queueing source scans `VoxelWorld::dirty_chunks()` while NAADF is enabled.
- Queueing now no-ops when `NaadfConfig.enabled` is false, preserving default behavior.

### NAADF-032: Terrain Dirty Ordering Hook

Updated:

- `src/voxel/plugin.rs`
- `src/voxel/world.rs`
- `src/rendering/naadf/dirty.rs`

Details:

- Added `VoxelTerrainSet` with:
  - `GeneratedChunks`
  - `NaadfDirtyQueue`
  - `MeshDirty`
- Configured these sets in order during `Update`.
- Assigned chunk generation polling to `GeneratedChunks`.
- Assigned mesh dirty processing to `MeshDirty`.
- This creates the scheduling slot needed for NAADF dirty queueing before mesh dirty flags are cleared.
- Added explicit `VoxelWorld` derived-cache dirty tracking through `derived_dirty_chunks`.
- Chunk insertion, chunk dirty marking, and legal terrain edits now mark derived chunks independently of mesh dirty flag lifetime.
- Added `VoxelWorld::derived_dirty_chunks` and `VoxelWorld::take_derived_dirty_chunks`.
- NAADF dirty queueing now drains the derived dirty stream instead of scanning `VoxelWorld::dirty_chunks`.
- When NAADF is disabled, the dirty stream is drained without queueing work so default runtime behavior remains unchanged.
- Boundary edits still mark neighboring derived chunks through the existing neighbor dirty logic.
- Added tests for derived dirty membership and boundary edit neighbor tracking.

Note:

- NAADF dirty queueing and cache rebuild systems run in this set when the `naadf` feature is enabled.

### NAADF-034: In-Memory CPU Cache And Budgeted Rebuild

Added:

- `src/rendering/naadf/cache.rs`

Updated:

- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/dirty.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added `NaadfCache`, a feature-gated resource that stores CPU-built `NaadfChunk` data by chunk coordinate.
- Added `NaadfCacheBuildReport` with rebuilt count, removed-missing count, deferred count, and missing chunk list.
- Added `rebuild_naadf_cache_from_dirty_queue`.
- Cache rebuild consumes `NaadfDirtyChunkQueue` up to `naadf.chunk_cache.max_chunk_updates_per_frame`.
- Loaded chunks are extracted through `NaadfChunkExtractor`.
- Missing chunks are reported and removed from cache if they were previously present.
- Cache updates `NaadfStats.loaded_chunks`.
- Cache updates `NaadfCacheState`:
  - `ready` when cache has loaded chunks and no pending dirty chunks remain.
  - `warming` when pending dirty chunks remain.
  - `fallback_reason` when disabled, empty, or warming.
- Added cache unit coverage for missing chunk extraction and storing a loaded chunk.

### NAADF-033: Occupancy Comparison Diagnostics

Added/updated:

- `src/rendering/naadf/debug.rs`
- `src/runtime_commands.rs`

Details:

- Added `compare_chunk_occupancy`.
- Reports first N mismatches between a `VoxelWorld` chunk and a `NaadfChunk`.
- Reports local position plus world/NAADF occupied state.
- Added focused tests for a matching chunk and capped mismatch output.
- Added runtime command `runtime.compareNaadfChunkOccupancy`.
- Command payload:
  - `chunkId`: `chunk-x-z` or `chunk-x-y-z`
  - `maxMismatches`: optional, defaults to 16, capped at 256
- Command response reports:
  - chunk coordinate
  - whether the `VoxelWorld` chunk exists
  - whether the NAADF cache chunk exists
  - mismatch count
  - first mismatches up to the requested limit
- When the `naadf` feature is disabled, the command returns `Unsupported`.
- Editor/UI button integration is still pending.

### NAADF-040: VoxelRayBackend Abstraction

Added:

- `src/rendering/voxel_ray_backend.rs`

Details:

- Added `VoxelRayPurpose` covering:
  - debug
  - sun visibility
  - GI secondary
  - terrain AO
  - contact shadow
  - preview primary
- Added `VoxelRayHit`.
- Added `VoxelRayBackendStats`.
- Added `VoxelRayBackend` trait.
- Added `CurrentSdfRayBackend`, a borrowed `VoxelWorld` debug wrapper that can trace current world occupancy through the shared trait.
- The default empty current backend is not ready until constructed with `CurrentSdfRayBackend::from_world`.

### NAADF-041: CPU NAADF Ray Traversal

Added:

- `src/rendering/naadf/cpu_trace.rs`

Details:

- Added slow CPU DDA traversal through loaded NAADF chunks.
- Records hit chunk, local voxel, world voxel, hit position, normal, distance, material ID, and step count.
- Tests cover single-voxel hit, empty miss, and cross-chunk boundary hit.

### NAADF-042: Current SDF Backend Wrapper

Updated:

- `src/rendering/voxel_ray_backend.rs`

Details:

- Implemented `CurrentSdfRayBackend::from_world`.
- Added CPU DDA tracing against `VoxelWorld::sample_voxel`.
- Uses current world occupancy semantics:
  - solid voxels hit
  - air misses
  - water misses because `VoxelType::Water` is not solid
  - virtual in-bounds bedrock can be reported through `VoxelWorld::sample_voxel`
- Populates `VoxelRayHit` with chunk/local/world voxel coordinates, position, normal, distance, material ID, and step count.
- Production GI/rendering remains unchanged.
- Added focused tests for:
  - solid voxel hit
  - air/water miss
  - not-ready default backend

### NAADF-043: A/B Debug Ray Comparison

Added/updated:

- `src/rendering/naadf/debug.rs`
- `src/runtime_commands.rs`
- `src/rendering/voxel_ray_backend.rs`

Details:

- Added `VoxelRayPurpose::as_str` and `VoxelRayPurpose::parse`.
- Added `NaadfRayComparison`.
- Added `compare_backend_ray`, which traces the same ray through:
  - current `VoxelWorld` occupancy via `trace_voxel_world_cpu`
  - NAADF CPU cache via `NaadfCpuRayBackend`
- Comparison reports:
  - current hit
  - NAADF hit
  - current step count
  - NAADF step count
  - boolean hit parity result
- Hit parity currently checks hit/miss state, hit world voxel, material ID, and distance tolerance.
- Added runtime command `runtime.compareNaadfRay`.
- Command payload:
  - `origin`: `[x, y, z]`
  - `direction`: `[x, y, z]`
  - `maxDistance`: optional, defaults to 256, capped at 4096
  - `purpose`: optional, defaults to `debug`
- Command response returns current and NAADF hit payloads with step counts.
- When the `naadf` feature is disabled, the command returns `Unsupported`.
- Added focused tests for matching current/NAADF ray hits and hit/miss mismatch reporting.

### NAADF-050: GPU Buffers

Updated:

- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`

Details:

- Added render-app-owned `NaadfGpuBuffers`.
- Added extracted GPU config for the render world.
- Added allocation for NAADF voxel, material, block, chunk, upload scratch, debug ray, and stats buffers.
- Buffers are created only when `NaadfConfig.enabled` is true.
- Allocation is blocked on integrated GPUs unless `allow_integrated_gpu` is true.
- Buffer plan uses `chunk_cache.max_chunks` and refuses allocation if the estimate exceeds `max_gpu_memory_mb`.
- GPU memory estimate and max chunk capacity sync back into `NaadfStats`.
- Added unit tests for buffer planning, memory cap enforcement, and chunk-slot fragmentation monitoring.

### NAADF-051+ GPU/Preview Scaffolding

Added:

- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/prepare.rs`
- `src/rendering/naadf/preview.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added preview settings resource.
- Added stats sync helper for dirty queue state.

These are scaffolding only. Apart from the gated NAADF-050 buffer resources and NAADF-052 CPU-built chunk uploads, no compute or render pipelines are active yet.

### NAADF-051: GPU Chunk Slot Table

Updated:

- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`
- `src/debug_ui.rs`

Details:

- Added `NaadfGpuChunkTable` as a main-world resource.
- Slot table capacity follows `naadf.chunk_cache.max_chunks`.
- Loaded CPU cache chunks receive stable GPU slots.
- Slots are released when chunks disappear from the CPU NAADF cache.
- Slot allocation refuses to exceed configured capacity.
- Slot stats now track used slots, available slots, reserved slots, free-list slots, and free-slot fragmentation.
- Debug settings UI shows NAADF slot usage and fragmentation when built with the `naadf` feature.
- Added unit coverage for slot reuse, capacity reset behavior, and fragmentation stats.

### NAADF-052: Upload CPU-Built Chunks To GPU

Updated:

- `src/rendering/naadf/cache.rs`
- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`
- `src/debug_ui.rs`

Details:

- Cache rebuild reports now include rebuilt chunk coordinates.
- Added `NaadfGpuUploadQueue` for CPU-built chunk uploads.
- Rebuilt CPU cache chunks are queued for GPU upload after slot assignment.
- Render extraction packs queued chunks into chunk, block, voxel, and material records under `max_chunk_updates_per_frame` and `max_upload_bytes_per_frame`.
- Render prepare writes packed CPU-built chunks into the NAADF GPU buffers through `RenderQueue::write_buffer`.
- No render pipeline reads NAADF buffers yet.
- Upload stats track pending uploads, total queued uploads, chunks uploaded last frame, and bytes uploaded last frame.
- Debug settings UI shows pending uploads and last-frame upload counts when built with the `naadf` feature.
- Added unit coverage for packed upload record sizes, slot IDs, occupancy, and material IDs.

### NAADF-053: Register NAADF Render Systems

Updated:

- `src/rendering/naadf/mod.rs`
- `src/rendering/plugin.rs`

Details:

- Main app owns NAADF config, CPU cache, dirty queue, GPU slot table, upload queue, cache state, stats, and preview settings.
- Render app owns extracted GPU config, extracted upload packets, GPU buffers, and upload stats.
- Render extraction copies only the small config and budgeted upload packet set needed by the render world.
- Render prepare owns GPU buffer allocation and CPU-built chunk writes.
- Cleanup syncs GPU allocation/upload counters back to main-world `NaadfStats`.
- The whole NAADF plugin remains behind the `naadf` Cargo feature through `RenderingPlugin`.
- `rtk cargo check` passes with the feature disabled, preserving the current default renderer path.

### Shader Scaffolding

Added:

- `assets/shaders/naadf/common.wgsl`
- `assets/shaders/naadf/layout.wgsl`
- `assets/shaders/naadf/ray_trace.wgsl`
- `assets/shaders/naadf/build_blocks.wgsl`
- `assets/shaders/naadf/build_chunks.wgsl`
- `assets/shaders/naadf/build_bounds.wgsl`
- `assets/shaders/naadf/gi_trace.wgsl`
- `assets/shaders/naadf/first_hit.wgsl`
- `assets/shaders/naadf/spatial_resampling.wgsl`
- `assets/shaders/naadf/temporal_accumulation.wgsl`
- `assets/shaders/naadf/debug_visualize.wgsl`
- `assets/shaders/naadf/preview_lighting.wgsl`
- `assets/shaders/naadf/preview_composite.wgsl`

Details:

- Files exist as port targets and placeholders.
- They are not loaded by the render graph yet.
- They do not change visual output.

### NAADF-060: WGSL Layout/Common Shader

Updated:

- `assets/shaders/naadf/common.wgsl`
- `assets/shaders/naadf/layout.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added WGSL constants for NAADF block/chunk dimensions, node packing, record byte sizes, and packed record word counts.
- Added WGSL node state/payload helpers.
- Added WGSL layout helpers for chunk voxel indexing, chunk block indexing, block voxel indexing, block coordinate lookup, local-in-block lookup, and chunk world origin.
- Updated the layout shader import to Bevy/naga-oil import syntax.
- Added Rust tests that verify WGSL constants match Rust layout constants.
- Added a Rust test that verifies `layout.wgsl` imports `common.wgsl` through Bevy shader import metadata.

### NAADF-061: WGSL Ray Traversal

Updated:

- `assets/shaders/naadf/ray_trace.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Replaced the placeholder NAADF ray shader with a first dense DDA traversal path.
- Added WGSL hit payload fields for world voxel, local voxel, normal, distance, material ID, and step count.
- Added WGSL helpers for DDA step direction, initial `t_max`, `t_delta`, axis selection, hit construction, and miss construction.
- Traversal reads the uploaded voxel and material record buffers.
- Uniform-full chunks can return a hit using the packed chunk-node payload.
- Directional AADF skip bounds remain intentionally unused until CPU/GPU hit parity is available.
- Added Rust shader metadata tests that verify `ray_trace.wgsl` imports layout helpers and declares the dense traversal path.

### NAADF-062: GPU Ray Test Harness

Added:

- `src/rendering/naadf/gpu_tests.rs`
- `src/rendering/naadf/pipeline.rs`
- `assets/shaders/naadf/debug_trace_rays.wgsl`

Updated:

- `src/rendering/naadf/mod.rs`

Details:

- Added typed GPU ray input records for origin, direction, max distance, purpose, target chunk, packed chunk node, base slot offsets, and max steps.
- Added typed GPU ray output records for hit flag, distance, material ID, step count, world voxel, local voxel, and normal.
- Added CPU/GPU output comparison helpers with distance tolerance, material parity, and world-voxel parity.
- Added debug compute shader entry point that traces one ray per input record through `trace_naadf_dense_debug`.
- Added pipeline constants for the debug trace shader path and workgroup size.
- Added unit coverage for slot-derived record bases, readback payload comparison, and debug shader import metadata.
- Actual GPU dispatch/readback execution is still not run in this pass.

### NAADF-063: Debug Hit Visualization

Updated:

- `src/rendering/naadf/debug.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`
- `src/debug_ui.rs`

Details:

- Added `NaadfDebugRayVisuals` resource for GPU ray readback visualization data.
- Added conversion from GPU ray input/output records into ray endpoints, optional hit positions, normals, and step counts.
- Added GPU ray step tracking through `NaadfStats`, including first-hit preview average/max steps, sample count, and miss-reason counters from render-path readback.
- Added gizmo drawing for debug rays and hit normals behind `naadf.debug.visualize_ray_steps`.
- Debug settings UI now shows first-hit average/max GPU ray steps, sample count, and miss-reason buckets.
- Added unit coverage for readback-to-visual conversion and average-step calculation.
- Visual execution was not run by request.

### NAADF-070: Raw Voxel Upload Buffer

Updated:

- `src/rendering/naadf/gpu_buffers.rs`

Details:

- Added a dedicated raw voxel GPU buffer to the NAADF buffer allocation.
- Buffer planning now accounts for one raw `u32` voxel record per voxel per resident chunk.
- Upload packets now include raw voxel records alongside derived occupancy and material records.
- Raw voxel records pack occupancy in the high bit and material ID in the low bits.
- Render upload writes raw voxel records into the dedicated raw voxel buffer under the existing per-frame upload budget.
- Added unit coverage for raw buffer planning, raw record count, and raw occupancy/material packing.

### NAADF-071: Block Build Pass

Updated:

- `assets/shaders/naadf/common.wgsl`
- `assets/shaders/naadf/build_blocks.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added WGSL node construction helper.
- Added compute-side block builder that consumes raw voxel records.
- Builder emits packed block records with node, occupancy low/high words, and reserved bounds words.
- Empty blocks produce `UniformEmpty`.
- Fully occupied blocks produce `UniformFull` with the first material payload.
- Mixed blocks produce `Children`.
- Hash/dedup remains deferred until correctness is proven.
- Added shader metadata tests for the block builder import and raw voxel/block record usage.

### NAADF-072: Bounds Build Pass

Updated:

- `assets/shaders/naadf/build_bounds.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added compute-side directional bounds builder for packed block records.
- Bounds are derived from block occupancy low/high words.
- Empty blocks preserve the CPU convention of distance `4` in all directions.
- Full blocks naturally collapse to distance `0` in all directions.
- X/Y bounds are packed into block record word 1.
- Z bounds are packed into block record word 4.
- Ray traversal still does not consume bounds until CPU/GPU parity is proven.
- Added shader metadata tests for the bounds builder and packed-bound helper functions.

### NAADF-073: GPU Build Queue Diagnostics

Updated:

- `src/rendering/naadf/prepare.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`
- `src/debug_ui.rs`

Details:

- Added `NaadfGpuBuildQueue` for GPU build backlog diagnostics.
- Queue de-duplicates chunk positions.
- Rebuilt cache chunks enqueue GPU build work.
- Queue ages pending chunks once per update while NAADF is enabled.
- Stats expose pending GPU build count, oldest pending age, and total queued GPU builds.
- Debug settings UI shows pending GPU build queue size and oldest age.
- GPU builder dispatch still rebuilds the full allocated structure when `prefer_gpu_builder` is enabled; dirty-slot remapped dispatch is not implemented yet.
- Added unit coverage for dedupe and oldest-age reporting.

### NAADF-080: Sun Visibility Query

Added:

- `assets/shaders/naadf/lighting_queries.wgsl`

Updated:

- `src/debug_ui.rs`
- `src/rendering/naadf/layout.rs`

Details:

- Added WGSL `naadf_sun_visibility` query helper using the dense NAADF trace path.
- Added boolean sun visibility wrapper for future lighting call sites.
- Added debug settings checkbox for `NaadfConfig::use_for_sun_visibility`.
- Existing config keeps NAADF sun visibility disabled by default.
- Added shader metadata coverage for the lighting query shader import and sun visibility helper.
- No visual lighting integration or screenshot verification was run.

### NAADF-081: Terrain AO / Contact Shadow Experiment

Updated:

- `assets/shaders/naadf/lighting_queries.wgsl`
- `src/debug_ui.rs`
- `src/rendering/naadf/layout.rs`

Details:

- Added WGSL short-range occlusion helper using the dense NAADF trace path.
- Added `naadf_terrain_ao_visibility`.
- Added `naadf_contact_shadow_visibility`.
- AO and contact shadow query toggles remain independent through existing `NaadfConfig` fields.
- Debug settings UI now exposes terrain AO and contact shadow NAADF toggles.
- Defaults remain disabled.
- Shader metadata coverage now checks for AO/contact shadow query helpers.

### NAADF-082: Quality Preset Integration

Updated:

- `src/rendering/quality.rs`

Details:

- Added NAADF chunk-update budgets per render quality preset.
- Added NAADF upload-byte budgets per render quality preset.
- `Performance100` keeps NAADF chunk updates and upload bytes conservative.
- `Low` and `Performance100` disable expensive NAADF contact-shadow queries.
- Existing renderer quality behavior is preserved.
- Added unit coverage for conservative `Performance100` budgets and low-quality contact-query disabling.

### NAADF-090: Backend Selection To Radiance Cascades

Updated:

- `src/rendering/radiance_cascades.rs`

Details:

- `RadianceCascadesConfig` now mirrors the selected voxel ray backend.
- `CurrentWithNaadfGi` and `NaadfPreview` force the GI backend state to `Naadf`.
- Backend switch generation mirrors `RayTracingSettings`.
- GI temporal state resets frame index and previous view-projection when backend switch generation changes and history reset is enabled.
- Added unit coverage for backend mirroring, forced NAADF GI mode, and history reset.

### NAADF-091: Shader-Side GI Trace Abstraction

Updated:

- `assets/shaders/radiance_cascades.wgsl`
- `assets/shaders/naadf/gi_trace.wgsl`
- `src/rendering/radiance_cascades.rs`
- `src/rendering/naadf/layout.rs`

Details:

- Radiance cascade uniforms now carry voxel backend code and backend switch generation.
- Radiance shader now routes probe rays through `trace_gi_backend`.
- Current SDF remains the active default path.
- NAADF branch is explicit but falls back to current SDF until the real NAADF GI pipeline/bind group is wired.
- Updated `gi_trace.wgsl` to call the dense NAADF trace helper with explicit record bases.
- Added unit coverage for backend codes in radiance uniforms.
- Added shader metadata/string coverage for the GI backend abstraction.

### NAADF-092: GI Timing Counters

Updated:

- `src/rendering/radiance_cascades.rs`
- `src/rendering/naadf/stats.rs`

Details:

- Added NAADF GI timing/counter system behind the `naadf` feature.
- Timing recorder rows now include:
  - `naadf.gpu_memory_bytes`
  - `naadf.chunks_resident`
  - `naadf.dirty_chunks_pending`
  - `naadf.uploaded_chunks_last_frame`
  - `naadf.avg_ray_steps_last_frame`
  - `naadf.gi_rays_last_frame`
- `NaadfStats` now records estimated GI rays last frame.
- Estimated GI rays are counted only when Radiance Cascades is using the NAADF backend.
- Added unit coverage for NAADF-only GI ray estimation.

### NAADF-093: GI A/B Benchmark Scenes

Added:

- `bench/scenes/naadf/visual-regression-naadf-live-lod.toml`

Details:

- Existing NAADF current/GI/preview, gameplay smoke, and dig-edit stability scenes remain in place.
- Added the missing live-LOD NAADF GI visual regression scene.
- Live-LOD scene keeps terrain LOD unfrozen and uses `current_with_naadf_gi`.
- Scene includes ridge run, jump/water, and forest sweep checkpoints with fixed screenshot points.
- Non-visual bench module tests pass after adding the scene.
- Bench scenes were not executed by request.

### NAADF-100: Debug Overlay Panel

Updated:

- `src/debug_ui.rs`

Details:

- Debug settings panel shows selected voxel backend and experimental render mode.
- Panel exposes NAADF cache enable toggle.
- Panel exposes NAADF sun visibility, terrain AO, and contact shadow toggles.
- Panel shows loaded cache chunks, dirty pending chunks, and dirty in-flight chunks.
- Panel shows GPU memory estimate, slot usage, slot fragmentation, upload queue state, average GPU ray steps, and GPU build queue age.
- The panel works before GPU trace/render pipelines are active because it reads `NaadfStats` and config resources.
- Visual UI verification was not run by request.

### NAADF-101: Chunk Visualization

Updated:

- `src/rendering/naadf/debug.rs`
- `src/rendering/naadf/dirty.rs`
- `src/rendering/naadf/mod.rs`

Details:

- Added gizmo drawing for resident NAADF cache chunks.
- Added visually distinct outlines for pending and in-flight dirty chunks.
- Visualization is gated by `naadf.debug.visualize_chunks` and remains disabled by default.
- Dirty queue now exposes pending and in-flight chunk iterators for debug systems.
- Added unit coverage for debug-facing dirty queue iterators.
- Visual execution was not run by request.

### NAADF-102: Ray-Step Heatmap

Updated:

- `assets/shaders/naadf/debug_visualize.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added compute-side ray step heatmap input/output records.
- Added `naadf_ray_step_heatmap` color mapping from cheap to expensive traversal.
- Hit rays use higher alpha than misses.
- The debug heatmap remains disabled by default and is not wired into a render graph yet.
- Added shader metadata/string coverage for heatmap declarations.
- Visual execution was not run by request.

### NAADF-110: Visible-Region Cache Management

Added:

- `src/rendering/naadf/streaming.rs`

Updated:

- `src/rendering/naadf/cache.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`
- `src/debug_ui.rs`

Details:

- Added camera-centered visible-region interest tracking.
- New interest chunks are queued for NAADF dirty/cache build.
- Interest set is capped by `chunk_cache.max_chunks`.
- Eviction uses `radius_chunks + hysteresis_chunks` to avoid small-movement thrash.
- Evicted chunks are removed from the CPU NAADF cache.
- Debug UI reports streaming interest size.
- Added unit coverage for nearest-first target capping, hysteresis eviction, and world-position-to-chunk mapping.

### NAADF-111: Stale-Cache Fallback Policy

Updated:

- `src/rendering/ray_tracing.rs`
- `src/rendering/naadf/systems.rs`
- `src/rendering/naadf/mod.rs`

Details:

- `RayTracingSettings` now tracks selected backend and resolved/effective backend separately.
- Requested `CurrentSdf` resolves to `CurrentSdf`.
- Requested `Naadf` falls back to `CurrentSdf` while the cache is missing, warming, or stale.
- Requested `Auto` uses NAADF only when the cache is ready and not stale.
- Fallback reason is recorded in `RayTracingSettings`.
- NAADF stale cache threshold is currently 120 frames.
- Added unit coverage for warming fallback, stale fallback, and ready-cache NAADF resolution.

### NAADF-112: Heavy-Edit Stress Bench

Updated:

- `bench/scenes/naadf/dig-edit-naadf-stability.toml`

Details:

- Converted the NAADF dig-edit scene from smoke pressure to heavier edit stress.
- NAADF chunk update budget is capped at 1 chunk per frame.
- Hold duration increased to 240 frames.
- Dig probe starts earlier, runs every 10 frames, and uses radius 2.
- Crust rejection remains required.
- Non-visual bench module tests pass after the scene update.
- The bench itself was not executed by request.

### NAADF-120: Preview Render Mode Pipeline

Updated:

- `src/rendering/naadf/preview.rs`
- `src/rendering/naadf/mod.rs`

Details:

- Added `NaadfPreviewNodeLabel` for a dedicated future render graph node.
- Added `NaadfPreviewPipelineState`.
- Preview state activates when `ExperimentalRenderMode::NaadfPreview` is selected.
- Mode changes and backend switches increment preview history generation.
- Current renderer remains default.
- No render graph node execution was run by request.
- Added unit coverage for preview activation and backend-switch history reset.

### NAADF-121: First-Hit Terrain Shader

Updated:

- `assets/shaders/naadf/first_hit.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Replaced the placeholder first-hit shader with a dense NAADF first-hit helper.
- Added preview hit payload with color, distance, normal, and material ID.
- Added approximate preview material palette.
- Misses use a sky-like color placeholder.
- Water/props remain out of scope for this first preview pass.
- Added shader metadata coverage for first-hit imports and preview material path.

### NAADF-122: Preview Compositor

Updated:

- `src/rendering/naadf/preview.rs`
- `assets/shaders/naadf/preview_composite.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added preview composite modes: fullscreen, split view, and picture-in-picture.
- Preview settings default to split view.
- Added WGSL composite params and `naadf_preview_composite_color` helper.
- Preview mode/history state already resets on enter/exit and backend switch.
- Added unit coverage for default composite mode.
- Added shader metadata/string coverage for compositor modes.

### NAADF-130: Preview History Buffers

Updated:

- `src/rendering/naadf/preview.rs`
- `src/rendering/naadf/mod.rs`

Details:

- Added preview history planning for color and moments buffers.
- History plan tracks resolution and estimated bytes.
- Added preview history state with generation counter.
- History invalidates when the planned resolution changes.
- Preview pipeline state already invalidates history generation on mode/backend switches.
- GPU texture allocation remains deferred until preview render graph execution is wired.
- Added unit coverage for history byte estimates and resize invalidation.

### NAADF-131: Temporal Accumulation Pass

Updated:

- `assets/shaders/naadf/temporal_accumulation.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added temporal accumulation params with blend factor and reset flag.
- Added `naadf_temporal_accumulate` helper.
- Reset or invalid motion returns current color.
- Stable history blends current and history with clamped blend factor.
- Added shader metadata/string coverage for temporal blend/reset declarations.

### NAADF-132: Spatial Resampling Pass

Updated:

- `assets/shaders/naadf/spatial_resampling.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added spatial resampling params with enable flag, radius, depth sigma, and normal sigma.
- Added edge-aware `naadf_spatial_weight`.
- Added `naadf_spatial_accumulate` helper.
- Depth and normal deltas reduce cross-edge blending.
- Pass can be disabled through the shader params.
- Added shader metadata/string coverage for spatial resampling helpers.

### NAADF-140: Regression Guard Thresholds

Updated:

- `assets/config/bench_guard.toml`
- `src/bin/bench_guard.rs`
- `src/rendering/radiance_cascades.rs`

Details:

- Added a configurable `[naadf]` guard block with limits for GPU memory, dirty backlog, oldest pending rebuild age, average ray steps, uploaded chunks per frame, and frame-time regression percentage.
- `bench_guard` expands the `[naadf]` block into optional NAADF metric checks for the GI, preview, live-LOD, and heavy dig-edit scenes.
- NAADF metric checks skip cleanly when a run only provides non-NAADF summaries, so existing guard workflows remain compatible.
- Added NAADF frame regression checks for GI and preview summaries against `visual-regression-naadf-current.toml` when both summaries are supplied.
- Added timing output for `naadf.gpu_build_queue_oldest_age_frames` so the oldest dirty/rebuild backlog age can be guarded.
- Added `bench_guard` unit coverage for NAADF threshold expansion and frame-regression failure behavior.

### NAADF-141: Final User/Developer Docs

Added:

- `docs/rendering/naadf.md`
- `docs/rendering/naadf-debugging.md`
- `docs/rendering/naadf-benchmarks.md`

Details:

- Added user/developer overview for enabling NAADF through the Cargo feature and `assets/config/naadf.yaml`.
- Documented runtime modes, `F11` backend cycling, default-off safety policy, integrated GPU fallback, and current preview limitations.
- Added debugging guide for debug UI stats, runtime comparison commands, visual debug flags, and fallback causes.
- Added benchmark guide for current/NAADF A/B scenes, release bench commands, `bench_guard` usage, and baseline readiness requirements.
- Docs explicitly state that visual verification and NAADF baseline bench runs have not been executed for this implementation batch yet.

### NAADF-142: Release Gate And Default-Off Policy

Updated:

- `Cargo.toml`
- `assets/config/naadf.yaml`
- `README.md`
- `src/rendering/naadf/config.rs`

Details:

- Added explicit empty default Cargo feature set.
- Documented `naadf` as experimental/default-off in the feature list.
- Added default-off comments to `assets/config/naadf.yaml`, including integrated GPU opt-in policy.
- Added README release note pointing to the NAADF user, debugging, and benchmark docs.
- Added config tests that lock `NaadfConfig::default()` and checked-in `assets/config/naadf.yaml` to disabled-by-default behavior.
- Verified the current renderer remains the shipping default through unchanged `RayTracingSettings` defaults and README documentation.

### NAADF-FIX-001: Preserve Dirty Chunks While Disabled

Updated:

- `src/rendering/naadf/dirty.rs`

Details:

- Fixed `queue_existing_dirty_chunks` so it returns before draining `VoxelWorld::derived_dirty_chunks()` when NAADF is disabled.
- Added coverage proving disabled NAADF leaves derived dirty state intact and does not queue work.

### NAADF-FIX-002: Disable GPU Build Queue Until Dispatch Exists

Updated:

- `src/rendering/naadf/prepare.rs`

Details:

- Added an explicit `naadf_gpu_builder_dispatch_available()` gate, currently `false`.
- `queue_gpu_builds_from_cache_report` now clears and returns unless NAADF is enabled, GPU builder preference is enabled, and dispatch support exists.
- `sync_gpu_build_queue_stats` uses the same gate, preventing queued items from aging forever and forcing stale-cache fallback.
- Added coverage proving the queue is cleared while dispatch is unavailable.

### NAADF-FIX-003: Mixed-Material Full Block Handling

Updated:

- `assets/shaders/naadf/build_blocks.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- The WGSL block builder now tracks `uniform_material`.
- Full blocks become `NAADF_NODE_UNIFORM_FULL` only when all 64 voxels are occupied and all occupied voxels share the same material.
- Full mixed-material blocks remain `NAADF_NODE_CHILDREN`, matching the CPU builder policy.
- Added shader metadata coverage for the uniform-material guard.

### NAADF-FIX-004: Debug Ray Count Guard

Updated:

- `assets/shaders/naadf/debug_trace_rays.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added `NaadfDebugTraceParams` with `ray_count`.
- `debug_trace_rays` now returns early when `global_id.x` is outside the submitted ray count.
- Added shader metadata coverage for the guard.

### NAADF-FIX-005: Stop Fake NAADF GI Fallback

Updated:

- `assets/shaders/radiance_cascades.wgsl`
- `src/rendering/radiance_cascades.rs`
- `docs/rendering/naadf.md`

Details:

- Removed the shader-side `trace_naadf_gi_fallback` path that silently called `trace_current_sdf_gi`.
- Added an explicit unavailable NAADF GI branch that returns a miss if selected accidentally.
- Added a Rust-side `naadf_gi_shader_backend_available()` gate, currently `false`, so Radiance Cascades resolves to `CurrentSdf` until the real NAADF GI shader/backend bind group exists.
- Updated backend selection tests so experimental NAADF GI respects resolved fallback/current behavior.

### NAADF-FIX-006: Uniform-Full Debug Ray Entry

Updated:

- `assets/shaders/naadf/ray_trace.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Fixed `trace_naadf_dense_debug` uniform-full chunk handling to compute ray/chunk AABB entry.
- Rays that start outside a full chunk now hit at the chunk entry point instead of returning distance zero at the ray origin.
- Added shader metadata coverage for the chunk-entry helper.

### NAADF-200: GPU Render-Graph Dispatch Online

Updated:

- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/pipeline.rs`
- `src/rendering/naadf/prepare.rs`
- `src/rendering/naadf/gpu_buffers.rs`

Details:

- Confirmed the GPU render-graph path is online before landing the distance LOD work.
- The NAADF render graph can run the GPU build queue, preview first-hit dispatch, and preview composite path behind the `naadf` feature/config gates.
- This prerequisite was already effectively present before the NAADF-201 batch; it was treated as the hard gate for the later tickets.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path`: 1 test passed.
- `rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml`: completed in `bench-runs/2026-05-18T15-38-40Z/summary.json`.

### NAADF-201: Split Traversal / Payload Buffers

Updated:

- `assets/shaders/naadf/common.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added separate hot traversal and cold payload record layouts.
- Locked Rust/WGSL layout constants for traversal records, payload records, bounds records, mip counts, and chunk slots.
- Kept the split compatible with the existing CPU reference and the render-world GPU buffers that later builders consume.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl`: 23 tests passed after the distance LOD shader metadata updates.
- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed after the mip parity test fix.

### NAADF-202: GPU Base Chunk Builder

Updated:

- `assets/shaders/naadf/build_blocks.wgsl`
- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/pipeline.rs`
- `tests/naadf_gpu_layout.rs`

Details:

- Extended the GPU base builder so raw voxel uploads seed mip-0 traversal and payload records.
- Added GPU buffers for the split traversal/payload layout and kept the base-builder dispatch wired through the existing NAADF GPU queue.
- Added GPU layout coverage for the seeded base records.

Checks:

- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed.

### NAADF-203: GPU Mip Pyramid Builder

Updated:

- `assets/shaders/naadf/build_mips.wgsl`
- `src/rendering/naadf/cpu_builder.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/pipeline.rs`
- `tests/naadf_gpu_layout.rs`

Details:

- Added the CPU reference mip pyramid for `16 -> 8 -> 4 -> 2 -> 1` chunk levels.
- Added the GPU mip build shader and pipeline step that consumes lower levels and writes higher-level traversal/payload records.
- Published mip constants through Rust and WGSL so traversal, tests, and builders use the same layout.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::cpu_builder::tests::mip`: 2 tests passed.
- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed.

### NAADF-204: GPU Directional AADF Sweeps

Updated:

- `assets/shaders/naadf/build_mips.wgsl`
- `assets/shaders/naadf/common.wgsl`
- `src/rendering/naadf/cpu_builder.rs`
- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/pipeline.rs`
- `tests/naadf_gpu_layout.rs`

Details:

- Added mipped AADF directional bounds records for the derived NAADF cache.
- Kept CPU builder bounds as the reference for thin-feature and hole cases.
- Extended GPU mip building so traversal records, payload records, and bounds records stay in lockstep.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::cpu_builder::tests::mip`: 2 tests passed.
- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed.

### NAADF-205: CPU/GPU Parity Harness

Updated:

- `src/rendering/naadf/gpu_tests.rs`
- `tests/naadf_gpu_layout.rs`

Details:

- Added parity helpers that compare GPU-built mip traversal, payload, and bounds records against the CPU reference.
- Reports level, local cell, and field names on mismatch so failed parity checks are directly actionable.
- This closes the foundation gate for proceeding to residency, traversal, LOD, and texture work.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::gpu_tests::tests::mip_parity_helper_reports_level_local_and_field`: 1 test passed.
- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed.

### NAADF-206: Near-Chunk Residency Lookup

Updated:

- `src/debug_ui.rs`
- `src/rendering/naadf/stats.rs`
- `src/rendering/naadf/streaming.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Implemented the v1 dense near-residency table only; hash residency and far summaries remain later work.
- Added per-chunk finest resident mip tracking, footprint-derived residency planning, and missing-fine-mip request counters.
- Surfaced residency counters through NAADF stats and the debug UI.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::streaming::tests::footprint_residency`: 2 tests passed.

### NAADF-207: Multi-Chunk World Traversal

Updated:

- `assets/shaders/naadf/world_trace.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added world/chunk coordinate helpers for stepping rays across chunk boundaries.
- Added shader metadata coverage for the world traversal helpers before routing them into skip traversal.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl`: 23 tests passed.

### NAADF-208: AADF Skip Traversal

Updated:

- `assets/shaders/naadf/ray_trace.wgsl`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/pipeline.rs`

Details:

- Added mipped AADF bounds skip helpers to traversal.
- Kept the shader path bind-compatible with the existing first-hit and GI layouts while the LOD path was phased in.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl`: 23 tests passed.
- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed.

### NAADF-209: Continuous Cone-Footprint LOD

Updated:

- `assets/shaders/naadf/first_hit.wgsl`
- `assets/shaders/naadf/ray_trace.wgsl`
- `assets/shaders/naadf/world_trace.wgsl`
- `src/rendering/naadf/layout.rs`

Details:

- Added cone-footprint LOD selection to NAADF traversal rather than discrete distance tiers.
- Uses the mip pyramid and residency table to select a conservative resident mip while preserving forced fine descent near primary hits.
- Exposes missing fine-mip requests for diagnosing residency undersupply.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path`: 1 test passed.
- Preview-only bench completed in `bench-runs/2026-05-18T15-38-40Z/summary.json`.

### NAADF-210: Texture Parity

Updated:

- `assets/shaders/naadf/first_hit.wgsl`
- `src/rendering/naadf/cpu_builder.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/pipeline.rs`
- `bench/scenes/naadf/visual-regression-naadf-preview-only.toml`
- `src/bench/mod.rs`
- `assets/config/bench_guard.toml`

Details:

- Added textured first-hit preview sampling through the shared blocky texture array.
- Uses triplanar weights and `textureSampleLevel`, with the cone footprint feeding texture mip selection.
- Added a NAADF bench GPU-memory budget toggle and raised the bench guard NAADF GPU-memory cap to 1 GiB for the 8192-slot preview scenes.
- Preview-only visual output is textured in the fixed screenshots; no blue silhouette/occupancy-only preview remained in the inspected settle and settled images.

Checks:

- `rtk cargo test --lib --features naadf bench::tests::naadf_bench_cache_toggles_deserialize`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path`: 1 test passed.
- `rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml`: completed in `bench-runs/2026-05-18T15-38-40Z/summary.json`.
- `rtk cargo run --bin bench_guard -- bench-runs/2026-05-18T15-38-40Z/summary.json`: bench guard output reported `PASS: 187 check(s), 0 warning(s)`.

Bench result:

- Post-change preview-only run: median frame `47.36925 ms`, p99 frame `47.903 ms`.
- NAADF counters: `preview_first_hit_dispatches_last_frame = 1`, `preview_composite_passes_last_frame = 1`, `preview_pixels_last_frame = 518400`, `gpu_slots_used = 7896`, `gpu_memory_bytes = 880066816`, `missing_fine_mip_requests_last_frame = 0`.
- Residency counters: `streaming_mip0_chunks = 7584`; `streaming_mip1_chunks` through `streaming_mip4_chunks` remained `0` for this preview-only scene.
- `summary.json` has `git_dirty = true` because unrelated voxel LOD/meshing files and `docs/rendering/image/` were already dirty/untracked and were not included in the NAADF commits.
- A clean before/after `summary.json` pair was not captured for this final preview-only run; the recorded bench is the current post-change verification run after the bench memory budget/guard cap update.

### NAADF-211: Sun Visibility

Updated:

- `assets/shaders/naadf/lighting_queries.wgsl`
- `src/rendering/radiance_cascades.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/stats.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Routed the existing NAADF lighting query shader path into sun-visibility accounting.
- Added `naadf.radiance_sun_visibility_rays_per_pixel` bench output.
- Kept the query default-off behind the NAADF feature/config/backend selection.
- Shader metadata coverage verifies sun visibility uses the NAADF ray-trace import and sun query purpose.

Checks:

- `rtk cargo test --lib --features naadf rendering::radiance_cascades::tests::estimated_sun_visibility_rays_only_count_enabled_naadf_query`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_lighting_queries_import_ray_trace_for_sun_visibility`: 1 test passed.
- No new sun-visibility visual A/B bench was run in this batch; earlier Path A bench evidence remains in `docs/rendering/naadf-path-a/phase-3-sun-visibility-query.md`.

### NAADF-212: AO / Contact Shadow

Updated:

- `src/rendering/radiance_cascades.rs`
- `src/rendering/naadf/stats.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added per-query NAADF accounting for contact-shadow and terrain-AO rays.
- Added `naadf.radiance_short_range_rays_per_pixel` as the combined contact + terrain AO budget counter.
- Kept AO/contact routing independently controlled by the existing NAADF query mask.

Checks:

- `rtk cargo test --lib --features naadf rendering::radiance_cascades::tests::estimated_short_range_query_rays_only_count_enabled_naadf_queries`: 1 test passed.
- No new AO/contact visual A/B bench was run in this batch; earlier Path A evidence remains in `docs/rendering/naadf-path-a/phase-5-contact-shadows-and-ao.md`.

### NAADF-213: Radiance Cascades NAADF Backend

Updated:

- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added bench counters for NAADF Radiance Cascades backend availability and active query mask.
- Preserved `CurrentSdf` as the default backend while exposing the selected NAADF query mask for bench/debug verification.
- Kept existing Radiance Cascades NAADF shader backend selection behind the feature/config gate.

Checks:

- `rtk cargo test --lib --features naadf rendering::radiance_cascades::tests::naadf_gi_shader_backend_is_selectable_when_feature_is_enabled`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::naadf_bench_counters_publish_radiance_backend_state`: 1 test passed.
- No new GI visual A/B bench was run in this batch; earlier Path A GI evidence remains in `docs/rendering/naadf-path-a/phase-6-indirect-gi.md` and still blocks default promotion on active-pass performance.

### NAADF-214: Froxel Sun-Visibility Mask

Added:

- `assets/shaders/naadf/froxel_sun_mask.wgsl`
- `src/rendering/naadf/froxel.rs`

Updated:

- `assets/config/naadf.yaml`
- `src/rendering/naadf/config.rs`
- `src/rendering/naadf/layout.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/pipeline.rs`
- `src/rendering/naadf/stats.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added default-off froxel sun-mask config and state.
- Added one visibility ray per froxel cell planning, frame budget, and frames-per-full-update counters.
- Added shader metadata coverage for NAADF ray tracing from the froxel mask shader.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::froxel::tests::froxel_ray_count_is_one_ray_per_cell`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::froxel::tests::froxel_state_requires_naadf_sun_visibility_toggle`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_froxel_sun_mask_traces_one_visibility_ray_per_froxel`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::config::tests::checked_in_config_keeps_naadf_default_off`: 1 test passed.
- No froxel visual/fog bench was run in this batch.

### NAADF-215: God-Ray / Fog Integration

Updated:

- `assets/shaders/god_rays.wgsl`
- `src/atmosphere/fog.rs`
- `src/rendering/god_rays.rs`
- `tests/shader_alpha_tests.rs`

Details:

- Added default-off froxel mask hooks for screen-space god rays and volumetric fog intensity.
- God rays now carry NAADF froxel visibility/strength uniforms and modulate ray accumulation only when the froxel state is active.
- Fog reads the froxel mask state behind the `naadf` feature and leaves existing fog behavior unchanged while inactive.

Checks:

- `rtk cargo test --lib --features naadf rendering::god_rays::tests::inactive_froxel_mask_does_not_modulate_god_rays`: 1 test passed.
- `rtk cargo test --test shader_alpha_tests god_rays_accept_naadf_froxel_visibility_modulation`: 1 test passed.
- `rtk cargo test --lib --features naadf atmosphere::fog::naadf`: compiled and ran 0 matching tests.
- No god-ray/fog visual bench was run in this batch.

### NAADF-216: Static-Proxy Voxelization

Updated:

- `src/rendering/naadf/entities.rs`
- `src/rendering/naadf/mod.rs`
- `src/rendering/naadf/stats.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added `NaadfStaticVoxelProxy` and static proxy classes for large persistent actors.
- Added `NaadfStaticProxyPolicy` with conservative defaults requiring at least 64 occupied voxels and a 4-unit extent.
- Static proxies that fail policy are excluded from the NAADF entity volume registry.
- Added `naadf.static_proxy_volumes` and `naadf.static_proxy_skipped` bench counters.

Checks:

- `rtk cargo test --lib --features naadf rendering::naadf::entities::tests::static_proxy_policy_rejects_small_props`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::entities::tests::static_proxy_policy_accepts_large_static_actor`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::entities::tests`: 9 tests passed.

### NAADF-217: Temporal Invalidation For Dirty Chunks

Updated:

- `src/rendering/radiance_cascades.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added NAADF dirty-queue generation tracking to `SdfVolumeState`.
- When NAADF is the active Radiance Cascades backend and the dirty queue advances, lighting temporal history resets by clearing the frame index and previous view-projection.
- Current-SDF mode bookmarks dirty queue progress without resetting its lighting history.
- Added `naadf.lighting_history_dirty_generation` bench counter.

Checks:

- `rtk cargo test --lib --features naadf rendering::radiance_cascades::tests::naadf_dirty_chunks_reset_lighting_history_for_naadf_backend`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::radiance_cascades::tests::current_sdf_dirty_bookmark_does_not_reset_lighting_history`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::radiance_cascades::tests`: 25 tests passed.

### NAADF-218: `bench_guard` NAADF Lighting Thresholds

Updated:

- `assets/config/bench_guard.toml`
- `src/bin/bench_guard.rs`

Details:

- Extended the `[naadf]` guard block with lighting ray budgets:
  - sun visibility rays per pixel
  - contact shadow rays per pixel
  - terrain AO rays per pixel
  - short-range rays per pixel
  - froxel sun-mask rays per frame
- `bench_guard` expands those values into optional NAADF metric checks for every configured NAADF guard target.
- The checked-in limits are `1`, `1`, `4`, `5`, and `65536` respectively.

Checks:

- `rtk cargo test --bin bench_guard`: 2 tests passed.
- A lighting `summary.json` was not regenerated after adding the guard thresholds, so the new checks have not been exercised against a fresh lighting bench in this batch.

### NAADF-230: Path-B Compositor C1

Updated:

- `assets/config/naadf.yaml`
- `assets/shaders/naadf/first_hit.wgsl`
- `assets/shaders/naadf/preview_fullscreen_composite.wgsl`
- `assets/shaders/naadf/temporal_accumulation.wgsl`
- `bench/scenes/naadf/visual-regression-naadf-path-b-depth-audit.toml`
- `bench/scenes/naadf/visual-regression-naadf-path-b-hybrid.toml`
- `docs/rendering/naadf-path-b-compositor-plan.md`
- `src/bench/mod.rs`
- `src/rendering/naadf/{config.rs,layout.rs,mod.rs,pipeline.rs,preview.rs,stats.rs,systems.rs}`

Details:

- Added default-off Path-B config and bench toggles for `off`, `hybrid_far_terrain`, and `depth_audit`.
- Added a hard `foundation_200_210_verified` gate so Path-B output is unavailable unless NAADF is enabled and the foundation is explicitly marked verified for the run.
- Added depth-prepass setup for Path-B cameras and a compositor bind contract for scene color, scene depth, foreground coverage, and NAADF first-hit depth.
- First-hit depth now exposes linear view depth in `R`, ray distance in `G`, diagnostic reason in `B`, and hit alpha in `A`; the compositor no longer compares normalized ray distance against raster depth.
- Hybrid mode keeps current scene color when foreground coverage is present, when raster depth is nearer than NAADF linear depth plus epsilon, or when NAADF misses.
- DepthAudit mode overlays deterministic diagnostic colors for NAADF accepts, coverage rejects, depth rejects, and misses.
- Path-B temporal is default-off until ownership-mask history rejection is implemented.
- Path-B counters are published to bench summaries, but per-pixel accept/reject GPU counter readback is not implemented; only the compositor pass counter currently proves that the mode ran.
- Path B remains experimental and is not evidence that the legacy mesh LOD seam issue is fixed.

Checks:

- `rtk cargo check --features naadf`: compiler finished successfully; the local `rtk` wrapper returned a non-zero shell status because it forwards Cargo status text on stderr.
- `rtk cargo test --lib --features naadf rendering::naadf::config::tests::checked_in_config_keeps_naadf_default_off`: 1 test passed.
- `rtk cargo test --lib --features naadf rendering::naadf::preview`: 7 tests passed.
- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl`: 24 tests passed.
- `rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path`: 1 test passed.
- `rtk cargo test --lib --features naadf bench::tests::naadf_bench_cache_toggles_deserialize`: 1 test passed.
- `rtk cargo test --features naadf --test naadf_gpu_layout`: 2 tests passed.

Bench evidence:

- Preview-only foundation run: `bench-runs/2026-05-18T17-58-11Z/summary.json`; median `60.327 ms`, p99 `61.316 ms`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`.
- Path-B hybrid run: `bench-runs/2026-05-18T18-04-51Z/summary.json`; median `49.645 ms`, p99 `46.324 ms`; `ready_wait_secs = 75.023`, `render_ready_secs = 4.901`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`. The settled screenshot was inspected and showed textured hybrid terrain with current-rendered structures/foreground preserved.
- Path-B DepthAudit run: `bench-runs/2026-05-18T18-10-37Z/summary.json`; median `35.121 ms`, p99 `38.451 ms`; `ready_wait_secs = 54.343`, `render_ready_secs = 3.241`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`. The settled screenshot was inspected and showed the expected audit tint and NAADF accepted region.
- Startup-stability run: `bench-runs/2026-05-18T18-13-07Z/summary.json`; median `34.850 ms`, p99 `68.579 ms`; runtime ready wait was about `53.6 s`, render-ready wait about `3.6 s`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`. The first staged screenshot at frame `120` / `elapsed_secs = 69.532` was already visually textured rather than the blue silhouette/early occupancy preview.

## Verification Completed

The following non-visual checks were run after the implementation passes:

```bash
rtk cargo check
rtk cargo check --features naadf
rtk cargo test voxel_ray_backend::tests
rtk cargo test voxel::world::tests
rtk cargo test --features naadf --test naadf_cpu_layout
rtk cargo test --features naadf rendering::naadf::debug::tests
rtk cargo test --features naadf rendering::naadf::gpu_buffers::tests
rtk cargo test --features naadf rendering::naadf::layout::tests
rtk cargo test --features naadf rendering::naadf::gpu_tests::tests
rtk cargo test --features naadf rendering::naadf::debug::tests
rtk cargo test --features naadf rendering::naadf::prepare::tests
rtk cargo test --features naadf rendering::quality::tests
rtk cargo test --features naadf rendering::radiance_cascades::tests
rtk cargo test bench::tests
rtk cargo test --features naadf rendering::naadf::dirty::tests
rtk cargo test --features naadf rendering::naadf::streaming::tests
rtk cargo test --features naadf rendering::ray_tracing::tests
rtk cargo test --features naadf rendering::naadf::preview::tests
rtk cargo test --bin bench_guard
rtk cargo test --features naadf rendering::naadf::config::tests
rtk cargo test --features naadf rendering::naadf::dirty::tests
rtk cargo test --features naadf rendering::naadf::prepare::tests
rtk cargo test --features naadf rendering::naadf::layout::tests
rtk cargo test --features naadf rendering::radiance_cascades::tests
rtk cargo test --features naadf rendering::naadf::gpu_tests::tests
rtk cargo test --lib --features naadf rendering::naadf::cpu_builder::tests::mip
rtk cargo test --lib --features naadf rendering::naadf::gpu_tests::tests::mip_parity_helper_reports_level_local_and_field
rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl
rtk cargo test --lib --features naadf rendering::naadf::streaming::tests::footprint_residency
rtk cargo test --features naadf --test naadf_gpu_layout
rtk cargo test --lib --features naadf bench::tests::naadf_bench_cache_toggles_deserialize
rtk cargo test --lib --features naadf rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
rtk cargo run --bin bench_guard -- bench-runs/2026-05-18T15-38-40Z/summary.json
rtk cargo test --lib --features naadf rendering::naadf::preview
rtk cargo test --features naadf --test naadf_gpu_layout
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-hybrid.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-path-b-depth-audit.toml
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

Results:

- `cargo check`: passed.
- `cargo check --features naadf`: passed.
- `voxel_ray_backend::tests`: 3 tests passed.
- `voxel::world::tests`: 14 tests passed.
- `naadf_cpu_layout` test target: 6 tests passed.
- `rendering::naadf::debug::tests`: 5 tests passed.
- `rendering::naadf::gpu_buffers::tests`: 7 tests passed.
- `rendering::naadf::layout::tests`: 14 tests passed.
- `rendering::naadf::gpu_tests::tests`: 3 tests passed.
- `rendering::naadf::prepare::tests`: 3 tests passed.
- `rendering::quality::tests`: 2 tests passed.
- `rendering::radiance_cascades::tests`: 6 tests passed.
- `bench::tests`: 21 tests passed.
- `rendering::naadf::dirty::tests`: 2 tests passed.
- `rendering::naadf::streaming::tests`: 3 tests passed.
- `rendering::ray_tracing::tests`: 3 tests passed.
- `rendering::naadf::preview::tests`: 5 tests passed.
- `bench_guard` binary tests: 2 tests passed.
- `rendering::naadf::config::tests`: 2 tests passed.
- `rendering::naadf::dirty::tests`: 3 tests passed after NAADF-FIX-001.
- `rendering::naadf::prepare::tests`: 4 tests passed after NAADF-FIX-002.
- `rendering::naadf::layout::tests`: 15 tests passed after NAADF-FIX-003/004/005/006.
- `rendering::radiance_cascades::tests`: 6 tests passed after NAADF-FIX-005.
- `rendering::naadf::gpu_tests::tests`: 3 tests passed after NAADF-FIX-004.
- These checks were rerun after adding the cache/rebuild system.
- These checks were rerun after adding the occupancy comparison runtime command.
- These checks were rerun after implementing the current backend wrapper.
- These checks were rerun after adding A/B debug ray comparison.
- These checks were rerun after adding explicit derived-cache dirty tracking.
- The fixture loader test was rerun after converting optional RON fields to `Some(...)`.
- The feature-gated compile and GPU buffer tests were rerun after adding render-app GPU buffer allocation.
- The feature-gated compile and GPU buffer tests were rerun after wiring the GPU chunk slot table to the CPU NAADF cache.
- The feature-gated compile and GPU buffer tests were rerun after adding the CPU-built chunk upload path.
- `cargo check` was rerun without the `naadf` feature after render-app registration and upload wiring.
- The feature-gated layout tests were rerun after adding WGSL common/layout constants and import checks.
- The feature-gated layout/shader metadata tests were rerun after adding the first WGSL dense ray traversal.
- The feature-gated GPU ray harness tests were run after adding typed debug ray input/output records and the debug compute shader entry point.
- The feature-gated debug tests were rerun after adding readback-to-gizmo visualization state.
- The feature-gated GPU buffer tests were rerun after adding raw voxel upload records and the raw voxel GPU buffer.
- The feature-gated layout/shader metadata tests were rerun after adding the raw-voxel block builder shader.
- The feature-gated layout/shader metadata tests were rerun after adding the bounds build shader.
- The feature-gated prepare tests were run after adding the incremental GPU build queue.
- The feature-gated layout/shader metadata tests were rerun after adding the NAADF sun visibility query shader.
- The feature-gated layout/shader metadata tests were rerun after adding AO and contact shadow lighting query helpers.
- `cargo check` and `cargo check --features naadf` were rerun after adding NAADF quality preset integration.
- The feature-gated render quality tests were run after adding NAADF quality budgets.
- The feature-gated radiance cascade tests were run after adding GI backend selection and history reset.
- The feature-gated radiance and layout/shader metadata tests were rerun after adding shader-side GI backend abstraction.
- `cargo check` and `cargo check --features naadf` were rerun after adding NAADF GI timing counters.
- The feature-gated radiance tests were rerun after adding NAADF GI ray counter estimation.
- The non-visual bench module tests were run after adding the NAADF live-LOD GI scene.
- `cargo check --features naadf` was rerun after expanding the NAADF debug panel.
- The feature-gated dirty queue tests were rerun after adding debug chunk visualization iterators.
- The feature-gated layout/shader metadata tests were rerun after adding the ray-step heatmap shader.
- The feature-gated streaming tests were run after adding visible-region cache management.
- The feature-gated ray tracing tests were run after adding NAADF stale-cache fallback policy.
- The non-visual bench module tests were rerun after increasing NAADF dig-edit stress.
- The feature-gated preview tests were run after adding preview mode pipeline state.
- The feature-gated layout/shader metadata tests were rerun after adding the first-hit preview shader.
- The feature-gated preview and layout/shader metadata tests were rerun after adding preview compositor modes.
- The feature-gated preview tests were rerun after adding preview history planning.
- The feature-gated layout/shader metadata tests were rerun after adding temporal accumulation helper logic.
- The feature-gated layout/shader metadata tests were rerun after adding spatial resampling helper logic.
- The non-visual `bench_guard` binary tests were run after adding configurable NAADF guard threshold expansion and frame regression checks.
- The feature-gated NAADF config tests were run after adding explicit release-gate/default-off coverage.
- Feature-gated dirty, prepare, layout, radiance, and GPU test-helper tests were rerun after the NAADF-FIX review batch.
- `rtk cargo test --features naadf rendering::naadf --lib`: 119 tests passed after the loaded-chunk preview coverage fix.
- `rtk cargo test --features naadf rendering::quality --lib`: 2 tests passed after raising High-quality NAADF warmup budgets.
- `rendering::naadf::cpu_builder::tests::mip`: 2 tests passed after the mip pyramid work.
- `rendering::naadf::gpu_tests::tests::mip_parity_helper_reports_level_local_and_field`: 1 test passed after the CPU/GPU parity harness.
- `rendering::naadf::layout::tests::wgsl`: 23 tests passed after the distance LOD WGSL metadata updates.
- `rendering::naadf::streaming::tests::footprint_residency`: 2 tests passed after the dense residency table.
- `naadf_gpu_layout` integration target: 2 tests passed after the GPU builder/mip parity fixes.
- `bench::tests::naadf_bench_cache_toggles_deserialize`: 1 test passed after the NAADF bench cache toggle.
- `rendering::naadf::layout::tests::wgsl_first_hit_declares_preview_material_path`: 1 test passed after the textured first-hit path.
- `visual-regression-naadf-preview-only.toml`: completed in `bench-runs/2026-05-18T15-38-40Z/summary.json`; median `47.36925 ms`, p99 `47.903 ms`.
- `bench_guard` on `bench-runs/2026-05-18T15-38-40Z/summary.json`: reported `PASS: 187 check(s), 0 warning(s)`.
- `visual-regression-naadf-path-b-hybrid.toml`: completed in `bench-runs/2026-05-18T18-04-51Z/summary.json`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`.
- `visual-regression-naadf-path-b-depth-audit.toml`: completed in `bench-runs/2026-05-18T18-10-37Z/summary.json`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`.
- `visual-regression-naadf-startup-stability.toml`: completed in `bench-runs/2026-05-18T18-13-07Z/summary.json`; `bench_guard` reported `PASS: 227 check(s), 0 warning(s)`.

## 2026-05-16 Preview Coverage Follow-Up

Manual split-view testing still showed missing high/far terrain after the visible-slot starvation fix. The follow-up diagnosis found a second coverage problem: the NAADF preview interest set was synthesized from fixed X/Y/Z offsets, so capacity could be spent on unloaded or empty positions while loaded `VoxelWorld` chunks that the normal renderer displayed were not selected.

Updated behavior:

- The NAADF visible interest set is now derived from loaded `VoxelWorld` chunks inside the NAADF stream radius.
- The synthetic fallback target shape is circular in XZ instead of square, matching the legacy horizontal cull model more closely.
- Default/manual preview coverage now uses `radius_chunks = 20`, matching `DEFAULT_CULL_DISTANCE = 320` at 16 units per chunk.
- Default/manual GPU slot capacity is `8192`, with High-quality warmup budgets raised to 16 chunks / 16 MiB per frame.
- The preview and startup-stability NAADF benches now run the 20-chunk / 8192-slot coverage path.

Verification:

- `rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview.toml`
  - Run: `bench-runs/2026-05-16T08-05-08Z/summary.json`
  - Median / p99 frame: 41.34 ms / 74.42 ms
  - `naadf.streaming_interest_chunks = 7584`
  - `naadf.gpu_slots_used = 7896`, `naadf.gpu_max_chunks = 8192`, `naadf.gpu_slots_available = 296`
  - `naadf.streaming_interest_missing_gpu_slots = 0`
  - `naadf.gpu_uploads_pending = 0`
  - `naadf.uploaded_chunks_peak = 1309`
  - Settled screenshot visually contains the high mountain cap and far structures.
- `rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml`
  - Run: `bench-runs/2026-05-16T08-12-27Z/summary.json`
  - Median / p99 frame: 41.59 ms / 71.66 ms
  - First staged screenshot at frame 120 (`elapsed_secs = 63.90`) was already visually stable for the tested checkpoint.
  - Startup trace CSVs were emitted for wait-ready, render-ready, and settle phases.
- `rtk cargo run --bin bench_guard -- bench-runs/2026-05-16T08-05-08Z/summary.json`: passed with one known warning for `naadf.max_ray_steps_last_frame = 256`.
- `rtk cargo run --bin bench_guard -- bench-runs/2026-05-16T08-12-27Z/summary.json`: passed with the same known max-ray-steps warning.

Known warning:

- Existing warning in `src/main.rs`: unused variable `use_vulkan_on_windows`.

## Historical Verification Gaps

Earlier NAADF batches deferred some visual/runtime verification. The preview coverage follow-up and the `NAADF-210` preview-only run above now cover the preview path, but the broader runtime/editor matrix is still not fully exercised.

Not run:

- Editor runtime rebuild.
- Desktop editor restart.
- Baseline runs for `visual-regression-naadf-current.toml`, `visual-regression-naadf-gi.toml`, and `visual-regression-naadf-preview.toml`.
- Clean before/after `summary.json` comparison for the final distance LOD batch.
- Clean before/after `summary.json` comparison for the Path-B compositor batch.
- NAADF GI visual checks.

## Current Behavior

- Current renderer remains default.
- NAADF is disabled by default in config.
- With NAADF disabled, dirty queueing/cache rebuild systems no-op.
- `CurrentSdf` remains the default production voxel ray backend.
- NAADF now has an experimental GPU build plus textured first-hit preview path behind the `naadf` feature/config gates.
- NAADF Path-B hybrid/depth-audit compositor modes are implemented as experimental, default-off, foundation-gated paths.
- Production terrain rendering, GI, AO, shadows, fog, and water still use the existing renderer/backend unless explicitly routed by later tickets.
- Visual output should only change when NAADF preview/config paths are explicitly enabled.

## Implemented: Local Point Lights (NAADF preview)

NAADF preview local-light support — planned in
`docs/rendering/naadf-local-lights-plan.md` — is **implemented** (commits
`dfdb862 Implement NAADF local point lights`, `b09b005 Improve NAADF local
light demo visibility`). Default-off, behind the `naadf` feature and the
preview path.

Added:

- `src/rendering/naadf/local_lights.rs`
- `bench/scenes/naadf/visual-regression-naadf-local-lights.toml`

Updated:

- `assets/shaders/naadf/first_hit.wgsl`, `assets/shaders/radiance_cascades.wgsl`
- `assets/config/naadf.yaml`
- `src/rendering/naadf/{config.rs,mod.rs,pipeline.rs,preview.rs,stats.rs,systems.rs}`
- `src/bench/mod.rs`

Details:

- `NaadfLocalLightRecord` — a 48-byte `Pod` GPU record (position + radius,
  linear colour + preview-scaled intensity, flags). Capacity
  `NAADF_LOCAL_LIGHT_MAX_RECORDS = 64`. A unit test locks the record size
  against the WGSL layout.
- `extract_naadf_local_lights` reads Bevy `PointLight` + `GlobalTransform` from
  the main world, skips zero-intensity / zero-range lights, sorts candidates by
  camera distance then intensity, and keeps up to `local_light_limit` (clamped
  to 64). Reports `visible` / `uploaded` / `culled`.
- Gated on `NaadfPreviewSettings.local_lights_enabled`; when disabled it inserts
  an empty extracted-lights resource and does no work.
- `prepare_naadf_local_light_gpu_buffer` allocates a 64-record storage buffer in
  the render world; `upload_naadf_local_lights` writes the kept records and
  publishes counts via `NaadfRenderStatsBridge::publish_local_lights`.
- `first_hit.wgsl` applies **direct primary-hit** point-light shading from the
  uploaded records. Per-light shadow casting is flagged
  (`NAADF_LOCAL_LIGHT_FLAG_CASTS_SHADOW`) from
  `local_light_shadows_enabled && light.shadows_enabled`.
- Bevy lumen-scale intensity is preview-scaled and capped
  (`preview_scaled_intensity`, ≤ 64) into the preview shader's range.
- Config keys added to `naadf.yaml` / `config.rs`; `NaadfPreviewSettings` carries
  `local_lights_enabled`, `local_light_limit`, `local_light_shadows_enabled`.
  `NaadfStats` exposes visible/uploaded/culled local-light counts.
- Bench scene `visual-regression-naadf-local-lights.toml` plus `bench/mod.rs`
  toggles exercise the path.

Not yet done (per the plan's phasing):

- GI bounce / Path-A radiance-cascade integration of local lights — this
  milestone is **direct primary-hit shading only**.

## Distance LOD And Texture Parity Status

NAADF distance LOD and textured first-hit parity are completed in
`docs/rendering/naadf-distance-lod-plan.md` (the `NAADF-200..210` foundation).

Implemented design summary:

- Seam-free terrain LOD — NAADF is ray-marched, so a coarse far region and a
  fine near region compose with no skirt/transition geometry.
- **Continuous cone-footprint LOD** in traversal (not discrete distance tiers,
  which pop); the same cone footprint also selects the texture mip.
- A **GPU-built** per-chunk mip pyramid (`16³→1³`) + inter-chunk coarse grid,
  with mipped directional skip bounds; CPU build kept only as parity reference.
- Footprint-derived residency so far chunks keep only coarse levels.
- **Textured first-hit** using the shared terrain atlas (triplanar) for visual
  parity with the legacy renderer — independent of the LOD phases.
- Hard prerequisite satisfied: GPU build/traverse dispatch came online before the build, traversal, LOD, and texture tickets landed.

## Implemented: NAADF Lighting (Path A)

NAADF as a voxel terrain lighting / ray-query backend is implemented in
`docs/rendering/naadf-lighting-plan.md` for `NAADF-211..218`.

Summary:

- **Path A**: NAADF can answer visibility / GI / occlusion ray queries while the current renderer keeps drawing the game.
- Phase 1 (`NAADF-211/212`) added sun visibility, AO, and contact-shadow query accounting.
- Phase 2 (`NAADF-213`) exposed the Radiance Cascades NAADF backend and query-mask state to bench counters.
- Phase 3 (`NAADF-214/215`) added the default-off froxel sun-mask scaffold and god-ray/fog hooks.
- Supporting work (`NAADF-216..218`) added static-proxy policy, dirty-history invalidation, and lighting guard thresholds.
- Path A remains default-off and is not default-promoted. Earlier Path A GI evidence still showed active NAADF GI slower than the current SDF baseline, so promotion requires new visual/performance evidence.
- Path B C1 is implemented as a default-off, foundation-gated experimental compositor; temporal ownership-mask integration remains deferred.

## Remaining Work

Release-gate work:

- Run fresh lighting A/B benches after `NAADF-211..218` and compare current SDF versus NAADF `summary.json` plus screenshots.
- Exercise the new `bench_guard` lighting thresholds against a fresh lighting summary.
- Decide default promotion only after the Path A active-pass performance gap is closed or accepted.

Deferred research:

- Path-B C2 ownership-mask temporal integration and per-pixel debug counter readback.
- `NAADF-240` DDGI/ReSTIR research.
- `NAADF-250` compression research.
