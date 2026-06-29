# BVY-WS-12 legacy bridge removal status

Status: In progress.

## Completed

- Added source-aware biome material helpers in `src/world/source/biome_material_id.rs`.
- Surface Nets now resolves `uv0.y` from source-aware biome material tags when present.
- The old four-weight compatibility adapter is now a fallback, not the preferred path.
- `world_source_acceptance` now tags its generated chunks with source-aware biome material IDs.
- Runtime async WorldSource chunk generation now builds chunks through `build_world_source_chunk`, so generated solid voxels carry source-aware biome material tags.
- Runtime generation was split by responsibility:
  - `generation/state.rs` owns generation state, task components, and queue state.
  - `generation/source.rs` owns terrain source mode selection.
  - `generation/stats.rs` owns chunk/world generation statistics.
  - `generation/legacy_chunk.rs` owns legacy terrain voxel filling.
  - `generation/world_load.rs` owns saved-world loading, bedrock enforcement, and saving.
  - `generation.rs` now stays focused on orchestration.
- Legacy terrain source mode is now marked deprecated and logs a warning when explicitly selected.
- Added `WorldSourceGpuReadbackProvider` plus a Rust/WGSL wire contract for drift readback samples.
- Added `assets/shaders/world_source/drift_readback.wgsl` for dominant-layer readback from prepared WorldSource samples.
- Added Rust layout tests for the drift readback params, input sample, and output sample structs.
- Added `GpuWorldSourceDriftReadbackDispatchPlan` for workgroup and buffer sizing.
- Added `decode_gpu_world_source_drift_outputs` to validate returned sample IDs before drift-gate comparison.
- Added `decode_staged_gpu_world_source_drift_bytes` to validate staging-byte length, cast returned GPU bytes, and decode samples into `WorldSourceGpuReadbackResult`.
- Added `src/world/source/drift_readback_render.rs` with render resources, buffer preparation, compute dispatch, staging-buffer copy, staging-buffer map, and state update.
- Added `GpuWorldSourceDriftReadbackStateProvider` so mapped render state can be consumed through the same `WorldSourceGpuReadbackProvider` interface as static/unavailable providers.
- Added `GpuWorldSourceDriftReadbackPlugin`, registered its render startup/prepare/cleanup systems, registered its Core3d graph node, and added it to the app bootstrap.
- Added main-world to render-world request extraction for `GpuWorldSourceDriftReadbackRequest`.
- Added `GpuWorldSourceDriftReadbackSharedResult` so render-world readback results can be consumed from the main app through `WorldSourceGpuReadbackProvider`.
- `world_source_acceptance` reports `material_draw_impact.compatibility_biome_channel_active = false` for the bench path.
- `world_source_acceptance` now fails before writing `summary.json` unless `terrain_source.mode` is `gpu_world_source`.

## Not completed

- No system currently populates `GpuWorldSourceDriftReadbackRequest` with BVY-WS-12 drift sample inputs before acceptance/debug readback.
- `world_source_acceptance` still uses the unavailable provider, so drift-gate runtime acceptance still reports `skipped`.
- Full height/biome drift still requires a WGSL port of `height_field.rs`, `island_shape.rs`, and `biome_region_field.rs`.
- The legacy terrain generator path is still present as a deprecated opt-in fallback.
- Full removal of the compatibility adapter should wait until the release acceptance report is reviewed and visual parity is accepted.

## Required next patch

Populate `GpuWorldSourceDriftReadbackRequest` from BVY-WS-12 drift sample points, wait for `GpuWorldSourceDriftReadbackSharedResult` to produce matching samples, then use that provider in the drift-gate acceptance path.
