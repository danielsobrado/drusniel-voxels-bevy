# NAADF Port Plan

Status: implementation scaffold  
Last reviewed: 2026-05-14

## Boundary

`VoxelWorld` remains the authoritative state for terrain, edits, saves, colliders, chunk streaming, and mesh generation. NAADF is a derived acceleration cache rebuilt from loaded Drusniel chunks. This keeps gameplay and the current mesh/PBR/water renderer on one world model while allowing NAADF to serve GI, shadow, AO, visibility, and preview ray queries.

NAADF starts as a voxel ray-query/GI backend, not a renderer replacement. The current renderer already owns water, props, vegetation, fog, sky, PBR materials, post-processing, quality presets, and benchmark scenes. Replacing that surface would be a renderer rewrite; the first shippable path is an optional backend with safe fallback to the current SDF path.

## Source Files To Port

- `NAADF/Content/shaders/render/rayTracing.fxh` -> `assets/shaders/naadf/ray_trace.wgsl`
- `NAADF/Content/shaders/world/data/chunkCalc.fx` -> `build_blocks.wgsl`, `build_chunks.wgsl`, `build_bounds.wgsl`
- `NAADF/Content/shaders/render/renderGlobalIllum.fx` -> `gi_trace.wgsl`
- `NAADF/Content/shaders/render/renderFirstHit.fx` -> `first_hit.wgsl`
- `NAADF/Content/shaders/render/renderSpatialResampling.fx` -> `spatial_resampling.wgsl`
- `NAADF/Content/shaders/render/renderTaaSampleReverse.fx` -> `temporal_accumulation.wgsl`

## Drusniel Modules Touched

- `src/rendering/ray_tracing.rs` for backend settings and F11 cycling.
- `src/rendering/voxel_ray_backend.rs` for backend-neutral ray query types.
- `src/rendering/naadf/` for config, layout, CPU builder, CPU tracing, extraction, dirty tracking, debug diagnostics, and stats.
- `src/rendering/plugin.rs` for resource/system registration.
- `src/bench/mod.rs` and `bench/scenes/*naadf*.toml` for reproducible A/B toggles.
- `src/runtime_commands.rs` and `src/debug_ui.rs` for non-visual runtime/debug visibility.
- `assets/config/naadf.yaml` for disabled-by-default settings.
- `assets/shaders/naadf/*.wgsl` for GPU parity and later GI/preview integration.

## Gates

- CPU parity gate: CPU layout and traversal must match Drusniel chunk occupancy for golden fixtures before GPU work is trusted.
- GPU parity gate: WGSL ray hits must match CPU ray hits before GI, AO, or shadow queries use NAADF.
- GI benchmark gate: NAADF GI stays optional unless release benches show stability, memory safety, and a useful performance or scalability win.
