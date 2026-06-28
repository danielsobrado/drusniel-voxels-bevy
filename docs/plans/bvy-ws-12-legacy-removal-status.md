# BVY-WS-12 legacy bridge removal status

Status: In progress.

## Completed

- Added source-aware biome material helpers in `src/world/source/biome_material_id.rs`.
- Surface Nets now resolves `uv0.y` from source-aware biome material tags when present.
- The old four-weight compatibility adapter is now a fallback, not the preferred path.
- `world_source_acceptance` now tags its generated chunks with source-aware biome material IDs.
- Runtime async WorldSource chunk generation now builds chunks through `build_world_source_chunk`, so generated solid voxels carry source-aware biome material tags.
- `world_source_acceptance` reports `material_draw_impact.compatibility_biome_channel_active = false` for the bench path.

## Not completed

- GPU readback producer is still missing, so drift-gate runtime acceptance still reports `skipped`.
- The legacy terrain generator path is still present as an opt-in fallback.
- Full removal of the compatibility adapter should wait until the release acceptance report is reviewed and visual parity is accepted.

## Required next patch

Add the GPU readback producer for WorldSource drift samples, then remove the remaining compatibility adapter once the release acceptance report records an accepted GPU/default path and visual parity has passed.
