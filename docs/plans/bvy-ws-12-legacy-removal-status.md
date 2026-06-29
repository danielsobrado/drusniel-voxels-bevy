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
- Added `assets/shaders/world_source/drift_readback.wgsl` for GPU-side dominant-layer readback from prepared WorldSource samples.
- Added Rust layout tests for `GpuWorldSourceDriftReadbackParams`, `GpuWorldSourceDriftInputSample`, and `GpuWorldSourceDriftOutputSample`.
- `world_source_acceptance` reports `material_draw_impact.compatibility_biome_channel_active = false` for the bench path.

## Not completed

- GPU readback dispatch and buffer mapping are still missing, so drift-gate runtime acceptance still reports `skipped`.
- Full GPU height/biome drift still requires a WGSL port of `height_field.rs`, `island_shape.rs`, and `biome_region_field.rs`.
- The legacy terrain generator path is still present as a deprecated opt-in fallback.
- Full removal of the compatibility adapter should wait until the release acceptance report is reviewed and visual parity is accepted.

## Required next patch

Implement the render-device provider that dispatches `assets/shaders/world_source/drift_readback.wgsl`, writes `GpuWorldSourceDriftInputSample` values, maps `GpuWorldSourceDriftOutputSample` back to `WorldSourceDriftSample`, and passes those samples into the existing drift gate.
