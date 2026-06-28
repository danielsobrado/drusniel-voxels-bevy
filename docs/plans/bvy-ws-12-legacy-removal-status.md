# BVY-WS-12 legacy bridge removal status

Status: In progress.

## Completed

- Added source-aware biome material helpers in `src/world/source/biome_material_id.rs`.
- Surface Nets now resolves `uv0.y` from source-aware biome material tags when present.
- The old four-weight compatibility adapter is now a fallback, not the preferred path.
- `world_source_acceptance` now tags its generated chunks with source-aware biome material IDs.
- `world_source_acceptance` reports `material_draw_impact.compatibility_biome_channel_active = false` for the bench path.

## Not completed

- Runtime async WorldSource chunk generation still needs to tag generated chunk materials with source-aware biome IDs.
- GPU readback producer is still missing, so drift-gate runtime acceptance still reports `skipped`.
- The legacy terrain generator path is still present as an opt-in fallback.
- Full removal of the compatibility adapter should wait until runtime generated chunks use source-aware biome tags and the acceptance bench is reviewed.

## Required next patch

Update `src/voxel/runtime/generation.rs` so `generate_world_source_chunk_async` builds chunks through a helper that assigns `material_with_biome(MaterialId::from_voxel(voxel), biome)` for non-air, non-water voxels.

The connector blocked the larger runtime helper rewrite during this pass, so this document records the remaining safe patch explicitly instead of pretending BVY-WS-12 is complete.
