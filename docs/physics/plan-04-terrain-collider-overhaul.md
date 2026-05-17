# Terrain Collider Overhaul Plan

This plan tracks the terrain-collision rewrite for editable smooth voxel terrain. The first implementation slice is now in code: the existing render-mesh collider path is still active, but it is wrapped by explicit collision state, revisions, and bench counters so the next phases can be measured.

## Current Fit

- `src/physics/terrain_collider.rs` still builds Avian terrain colliders from the render `Mesh3d`.
- `src/player/spawn.rs` and `src/player/input.rs` still use `ChunkCollider` plus `NeedsCollider` as the gameplay readiness source.
- `VoxelWorld::sample_voxel_for_collision` already provides conservative sampling for missing chunks, horizontal world bounds, and the bedrock crust.
- Surface Nets visual meshing already samples a padded boundary, so the overhaul should not start by changing visual mesh padding.
- `bench/scenes/collider/collider-walk-log.toml` is the required route bench for collider work.

## Target Architecture

```text
VoxelWorld authoritative data
    -> conservative collision occupancy cache with halo
    -> player support/readiness queries
    -> async terrain collision bake queue
    -> double-buffered Avian collider swap
```

The render mesh should stop being the authoritative terrain collider. The preferred terrain payload is `Collider::voxels` built from conservative occupancy. A greedy merged-AABB compound is the fallback if voxel contact quality or memory cost is poor. Trimesh collision remains only as a debug/A-B mode.

## Phases

1. **State and observability**: add terrain collision states, revisions, stale/failed counters, player readiness counters, and tests while preserving current behavior.
2. **Occupancy cache**: build a per-chunk conservative bit grid from `VoxelWorld::sample_voxel_for_collision`, including one-cell halo and core-cell ownership.
3. **Async baking**: snapshot collision bake inputs, bake off-thread, stage outputs, and apply a bounded number of collider swaps per frame.
4. **Voxel collider payload**: add `VOXEL_TERRAIN_COLLIDER=occupancy_voxels`, generate `Collider::voxels`, and keep current trimesh/heightfield/voxelized modes for A-B runs.
5. **Player fallback**: compute support-prism readiness from the collision cache, use source queries when Avian colliders are stale, and block movement into unknown source chunks.
6. **Crust guarantee**: keep the permanent bedrock/floor collider outside terrain rebuild scheduling.
7. **Props**: keep props on primitive Avian colliders first; add a secondary prop mesh only after player collision is stable.
8. **Bench hardening**: add readiness-bubble fields to gameplay traces and fail on stale publishes, fall-throughs, and unsupported frames.

## Acceptance Criteria

- Zero uncontrolled player fall-throughs in `bench/scenes/collider/collider-walk-log.toml`.
- Zero stale terrain collider revisions published.
- Player support-prism readiness is at least 99.9 percent during normal traversal.
- Foreground collider swap time remains inside the chosen frame budget.
- p95 terrain collision bake/swap cost improves over the current render-trimesh path.

## Current Implementation Status

Phase 1 is partially implemented:

- `TerrainCollisionRegistry`
- `TerrainCollisionState`
- `TerrainCollisionRevision`
- legacy marker-to-state bridge
- player collision readiness counters
- unit tests for state classification and revision transitions

Next implementation slice: build the authoritative occupancy cache without changing the live collider payload.

