# NAADF Implementation Status

Status: code-first implementation in progress  
Branch/worktree: `main`  
Last updated: 2026-05-14  
Visual verification: not run by request

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
- The current test file uses direct Rust fixture construction; RON fixture loading is still pending.

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

- `bench/scenes/visual-regression-naadf-current.toml`
- `bench/scenes/visual-regression-naadf-gi.toml`
- `bench/scenes/visual-regression-naadf-preview.toml`
- `bench/scenes/gameplay-movement-naadf-smoke.toml`
- `bench/scenes/dig-edit-naadf-stability.toml`

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

Details:

- Added `VoxelTerrainSet` with:
  - `GeneratedChunks`
  - `NaadfDirtyQueue`
  - `MeshDirty`
- Configured these sets in order during `Update`.
- Assigned chunk generation polling to `GeneratedChunks`.
- Assigned mesh dirty processing to `MeshDirty`.
- This creates the scheduling slot needed for NAADF dirty queueing before mesh dirty flags are cleared.

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

Added:

- `src/rendering/naadf/debug.rs`

Details:

- Added `compare_chunk_occupancy`.
- Reports first N mismatches between a `VoxelWorld` chunk and a `NaadfChunk`.
- Reports local position plus world/NAADF occupied state.
- Golden fixture command/UI integration is still pending.

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
- Added a placeholder `CurrentSdfRayBackend` wrapper that is ready but does not yet route to the current production SDF path.

### NAADF-041: CPU NAADF Ray Traversal

Added:

- `src/rendering/naadf/cpu_trace.rs`

Details:

- Added slow CPU DDA traversal through loaded NAADF chunks.
- Records hit chunk, local voxel, world voxel, hit position, normal, distance, material ID, and step count.
- Tests cover single-voxel hit, empty miss, and cross-chunk boundary hit.

### NAADF-050+ GPU/Preview Scaffolding

Added:

- `src/rendering/naadf/gpu_buffers.rs`
- `src/rendering/naadf/prepare.rs`
- `src/rendering/naadf/preview.rs`
- `src/rendering/naadf/systems.rs`

Details:

- Added GPU buffer capacity planning.
- Added `NaadfGpuChunkTable` with slot allocation and release.
- Added `NaadfGpuChunkTableStats` so long-session free-slot fragmentation can be monitored before deciding whether compaction is needed.
- Added upload budget and upload plan structs.
- Added preview settings resource.
- Added stats sync helper for dirty queue state.

These are scaffolding only. No GPU resources are allocated yet.

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

## Verification Completed

The following non-visual checks were run after the implementation passes:

```bash
rtk cargo check
rtk cargo check --features naadf
rtk cargo test --features naadf --test naadf_cpu_layout
```

Results:

- `cargo check`: passed.
- `cargo check --features naadf`: passed.
- `naadf_cpu_layout` test target: 5 tests passed.
- These checks were rerun after adding the cache/rebuild system.

Known warning:

- Existing warning in `src/main.rs`: unused variable `use_vulkan_on_windows`.

## Verification Not Run

Per request, no visual/runtime verification has been run.

Not run:

- Editor runtime rebuild.
- Desktop editor restart.
- Visual regression benches.
- Baseline runs for `visual-regression-naadf-current.toml`, `visual-regression-naadf-gi.toml`, and `visual-regression-naadf-preview.toml`.
- Screenshot inspection.
- Render timing comparisons.
- `bench_guard`.
- GPU shader execution.
- NAADF GI/preview visual checks.

## Current Behavior

- Current renderer remains default.
- NAADF is disabled by default in config.
- With NAADF disabled, dirty queueing/cache rebuild systems no-op.
- `CurrentSdf` remains the default voxel ray backend.
- Selecting NAADF only changes runtime state; it does not yet route production GI, AO, shadows, or preview rendering.
- No NAADF shader is loaded into a render pipeline yet.
- No visual output should change from these code paths unless a user explicitly toggles backend state, and even then the real render path still falls back to current behavior.

## Remaining Work

Next implementation batch:

- Add explicit dirty/mutation reporting for terrain edit paths where practical.
- Add debug command/payload to compare a targeted chunk against NAADF occupancy.
- Add CPU debug ray A/B comparison against current world occupancy.
- Complete `CurrentSdfRayBackend` wrapper enough for fixture/world comparisons.
- Add RON fixture loader for the golden fixture files.

GPU batch after CPU parity:

- Allocate real NAADF GPU buffers.
- Add chunk slot upload path.
- Add compute ray test pass.
- Port real WGSL traversal.
- Compare GPU hits against CPU hits before any GI integration.

Visual batch, intentionally deferred:

- Run NAADF current/GI/preview bench scenes.
- Inspect screenshots.
- Compare `bench-runs/<run>/summary.json`.
- Run `bench_guard` when performance-sensitive integration begins.
