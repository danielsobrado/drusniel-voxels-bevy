# BVY-WS-12 legacy bridge removal status

Status: In progress.

## Completed

- Added source-aware biome material helpers in `src/world/source/biome_material_id.rs`.
- Surface Nets now resolves `uv0.y` from source-aware biome material tags when present.
- The old four-weight compatibility adapter is no longer exported from the mesh module and is private legacy-mode fallback only.
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
- Added `src/world/source/drift_readback_request.rs` to populate `GpuWorldSourceDriftReadbackRequest` from BVY-WS-12 drift sample points when `VOXEL_WORLD_SOURCE_DRIFT_READBACK=1` is set.
- Added `src/world/source/drift_readback_acceptance.rs` so any `WorldSourceGpuReadbackProvider` can be evaluated through the existing CPU/GPU drift gate.
- Added `src/world/source/drift_readback_runtime_acceptance.rs` so the opt-in runtime path evaluates the shared GPU readback result once matching samples are available.
- Runtime readback acceptance now writes a JSON artifact to `bench-runs/world-source-runtime-acceptance/summary.json` by default, with `VOXEL_WORLD_SOURCE_DRIFT_ACCEPTANCE_OUT` available as an override.
- Added `bench/scenes/terrain/world-source-readback-acceptance.toml` as the minimal no-screenshot runtime scene for collecting the readback artifact.
- `world_source_acceptance` reports `material_draw_impact.compatibility_biome_channel_active = false` for the bench path.
- `world_source_acceptance` now fails before writing `summary.json` unless `terrain_source.mode` is `gpu_world_source`.
- `world_source_acceptance` now treats unavailable GPU readback and skipped/failed drift gates as acceptance blockers instead of allowing a CPU-only pass.
- Native Windows runtime-assisted GPU readback produced an accepted artifact at `bench-runs/world-source-runtime-acceptance/summary.json`.
- `world_source_acceptance` now validates the runtime artifact and records it as `runtime_gpu_readback_acceptance`; when accepted, the report uses its GPU readback/drift-gate result for top-level acceptance.
- The visual-regression render-ready gate now records final render signatures and instability diagnostics in each run record.
- Native Windows visual-regression verification at `bench-runs/2026-06-30T15-14-58Z/summary.json` cleared the previous render-ready timeout on all 7 checkpoints; each checkpoint reported `ready_timed_out: false`, `render_ready_timed_out: false`, and `render_ready_wait_frames: 90`.
- Native Windows visual-regression verification at `bench-runs/2026-07-01T01-50-08Z/summary.json` also cleared render-ready on all 7 checkpoints and `bench_guard` exits 0 against that artifact.
- The visual guard now treats `__frame_total` as presence-only evidence. It is sourced from `Time<Real>` wall-clock cadence and can include native Windows frame pacing and single-frame present/scheduler spikes; render graph CPU, GPU opaque, mesh dirty, instancing, water, and render-counter rows remain threshold-gated.

## Not completed

- Direct in-process runtime readback consumption by `world_source_acceptance` is still not implemented; the accepted path is pairing the focused bench report with the reviewed runtime-assisted artifact.
- Full height/biome drift still requires a WGSL port of `height_field.rs`, `island_shape.rs`, and `biome_region_field.rs`.
- The legacy terrain generator path is still present as a deprecated opt-in fallback.
- Full removal of explicit legacy mode should wait until the release acceptance report is reviewed and visual parity is accepted.

## Required next patch

Review the paired acceptance report, visual artifact, and updated guard decision together before removing explicit legacy mode.
