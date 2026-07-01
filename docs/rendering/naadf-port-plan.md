# NAADF Port Plan

Status: shipped experimental implementation record  
Last reviewed: 2026-07-01

This document started as the NAADF port plan. The Rust/Bevy implementation has now landed on `main` behind the `naadf` feature and remains default-off through `assets/config/naadf.yaml`. Treat this file as the boundary and port-map record, not as proof that NAADF is production-default.

## Current State

Rust/Bevy NAADF is implemented as an optional derived voxel ray-query backend:

- `VoxelWorld` remains authoritative.
- NAADF builds a derived cache from loaded chunks.
- CPU cache build, dirty tracking, visible-region streaming, CPU tracing, GPU buffer upload, render-world resources, preview passes, Path-B diagnostic compositor hooks, froxel sun-mask integration, local-light/entity-volume scaffolding, and bench/debug counters are present.
- The current renderer remains the gameplay renderer.
- Production use of NAADF for GI, sun visibility, terrain AO, contact shadows, and Path-B far terrain remains opt-in and default-off.

## Boundary

`VoxelWorld` remains the authoritative state for terrain, edits, saves, colliders, chunk streaming, and mesh generation. NAADF is a derived acceleration cache rebuilt from loaded Drusniel chunks. This keeps gameplay and the current mesh/PBR/water renderer on one world model while allowing NAADF to serve GI, shadow, AO, visibility, preview, and diagnostic ray queries.

NAADF is a voxel ray-query/GI/preview backend, not a full renderer replacement. The current renderer owns water, props, vegetation, fog, sky, PBR materials, post-processing, quality presets, and benchmark scenes. Replacing that surface would be a renderer rewrite; the current shipped path is an optional backend with safe fallback to the current SDF path.

## Source Files Ported / Mapped

- `NAADF/Content/shaders/render/rayTracing.fxh` -> `assets/shaders/naadf/ray_trace.wgsl`, `world_trace.wgsl`, `debug_trace_rays.wgsl`
- `NAADF/Content/shaders/world/data/chunkCalc.fx` -> `build_blocks.wgsl`, `build_chunks.wgsl`, `build_bounds.wgsl`, `build_mips.wgsl`, `build_chunk_bounds.wgsl`
- `NAADF/Content/shaders/render/renderGlobalIllum.fx` -> `gi_trace.wgsl`
- `NAADF/Content/shaders/render/renderFirstHit.fx` -> `first_hit.wgsl`, `first_hit_path_b_terrain.wgsl`
- `NAADF/Content/shaders/render/renderSpatialResampling.fx` -> `spatial_resampling.wgsl`
- `NAADF/Content/shaders/render/renderTaaSampleReverse.fx` -> `temporal_accumulation.wgsl`
- Additional Drusniel integration shaders: `lighting_queries.wgsl`, `froxel_sun_mask.wgsl`, `denoise.wgsl`, `path_trace.wgsl`, `preview_fullscreen_composite.wgsl`, `path_b_ownership.wgsl`

## Drusniel Modules Touched

- `src/rendering/ray_tracing.rs` for backend settings and F11 cycling.
- `src/rendering/voxel_ray_backend.rs` for backend-neutral ray query types.
- `src/rendering/naadf/` for config, layout, cache, CPU builder, CPU tracing, extraction, dirty tracking, streaming, GPU buffers, prepare/upload, local lights, froxel sun mask, preview, pipeline, debug diagnostics, systems, and stats.
- `src/rendering/plugin.rs` for feature-gated plugin registration.
- `src/bench/mod.rs` and `bench/scenes/naadf/*.toml` for reproducible A/B toggles.
- `src/runtime_commands.rs` and `src/debug_ui.rs` for runtime/debug visibility.
- `assets/config/naadf.yaml` for disabled-by-default settings.
- `assets/shaders/naadf/*.wgsl` for GPU build, traversal, query, preview, denoise, and compositor work.
- `tools/clod-poc/src/naadf/*` and `tools/clod-poc/docs/naadf-poc.md` for the browser validation prototype.

## Gates

Completed / implemented gates:

- CPU layout and traversal fixtures exist.
- CPU cache and dirty-stream plumbing exist.
- GPU buffer planning and upload path exist.
- Render graph preview/build nodes exist.
- Preview, Path-B hybrid, Path-B DepthAudit, startup-stability, and froxel god-ray bench paths have recorded local evidence in the implementation status file.

Still required before default promotion:

- Fresh release-machine visual/performance benches for Path A lighting queries.
- GPU dispatch/readback parity where still marked as validation-only.
- Path-B ownership-mask temporal history rejection.
- Full upstream queue-based chunk propagation parity, if still needed after profiling.
- Clear evidence that NAADF improves quality, stability, or scalability enough to justify production use.

## Related Status Files

- Main status: [`naadf.md`](naadf.md)
- Implementation record: [`naadf-implementation-status.md`](naadf-implementation-status.md)
- Remaining Jira-style plan: [`naadf-completion-jira-plan.md`](naadf-completion-jira-plan.md)
- CLOD PoC status: [`../../tools/clod-poc/docs/naadf-poc.md`](../../tools/clod-poc/docs/naadf-poc.md)
