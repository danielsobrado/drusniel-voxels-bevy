# CLOD edit dirtiness planner

`src/voxel/pages/edit_dirtiness.rs` maps a world-space terrain edit into the CLOD nodes that must be refreshed.

The flow is:

1. Expand the edit brush into conservative X/Z dirty bounds.
2. Convert those bounds into touched LOD0 page coordinates.
3. Walk every parent chain with Euclidean parent coordinates.
4. Feed those LOD0 pages into source remeshing and then `rebuild_dirty_pages`.

The planner is intentionally conservative. If an edit touches exactly on a page boundary, both neighboring pages are marked dirty. That keeps border weld/lock invariants safe after the edit rebuild.

This is a bridge between the scripted edit schema from `clod-edit-stress.toml` and the existing quadtree rebuild API:

```rust
use drusniel_voxels_bevy::voxel::pages::edit_dirtiness::{
    ClodDirtyPageGrid, plan_dirty_pages_for_sphere,
};

let grid = ClodDirtyPageGrid::try_new(
    lod0_page_size_cells,
    origin.min_page_x,
    origin.min_page_z,
    world_pages_x,
    world_pages_z,
    nodes_by_level.len(),
)?;
let plan = plan_dirty_pages_for_sphere(grid, brush_x, brush_z, radius, influence_margin);
```

Expected invariants:

- `lod0_page_coords` are clamped to the current CLOD tree footprint.
- parent levels are deduped and sorted for deterministic rebuild telemetry.
- negative page coordinates use `div_euclid(2)`, not truncating division.
- level 0 in `ancestor_node_coords_by_level` is always empty.
