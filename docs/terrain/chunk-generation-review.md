# Terrain Generation Performance Review

This document analyzes the current procedural chunk generation pipeline (`generate_chunk_async` and `TerrainGenerator::get_voxel`) and identifies significant architectural bottlenecks causing excessive CPU overhead. 

## Identified Bottlenecks

### 1. Redundant 2D Heightmap & Biome Evaluations (O(Y) cost)
In `generate_chunk_async`, the terrain generator loops over `(x, z, y)` and calls `generator.get_voxel(world_x, world_y, world_z)` for all 4,096 voxels in a chunk.
Inside `get_voxel`, it evaluates:
- `self.get_height(world_x, world_z)`
- `self.get_biome(world_x, world_z)`
- `self.get_water_generation_metadata(world_x, world_z)`

**The Issue:** These functions are strictly 2-Dimensional (they only depend on X and Z). Because they are called inside the inner `Y` loop, the expensive 2D Fractional Brownian Motion (FBM) math is recalculated 16 times per column unnecessarily. For a chunk, this equates to 4,096 full 2D evaluations instead of the required 256.

### 2. $O(N \times R^2)$ Tree Leaf Overlap Searching
The most severe performance penalty lies in `is_tree_leaves()`. 
If a voxel is above the terrain height, the generator checks if it should be a leaf by scanning a 2D neighborhood around the voxel (`dx` and `dz` from `-TREE_LEAF_CHECK_RADIUS` to `+TREE_LEAF_CHECK_RADIUS`). 
For each neighbor cell, it recalculates `get_height` and `should_spawn_tree` to see if a tree spawned there.

**The Issue:** 
- A 5x5 neighborhood check means 25 FBM evaluations.
- This is executed for *every* voxel in the chunk that sits above ground level.
- If a chunk is mostly air (e.g., 12 blocks of air per column), it executes $256 \times 12 \times 25 = 76,800$ FBM height evaluations just to check for leaves in a single chunk.

### 3. Per-Voxel Mutability Overhead
In `generate_chunk_async`, voxels are assigned via `chunk.set(pos, voxel)`.
`Chunk::set` is designed for live editing. It automatically performs bounds checking, updates `visibility_dirty`, resets `uniformity` to `Unknown`, and marks the chunk with `MeshDirtyReason::TerrainMutation`. Doing this 4,096 times per chunk generation task adds unnecessary instruction overhead when building a chunk from scratch.

---

## Proposed Remediation Plan

To dramatically improve generation speed, we need to invert the data flow from "pull" (voxel asks its surroundings) to "push" (surroundings are precalculated for the chunk).

### Step 1: Precompute a 2D `TerrainColumn` Array
At the start of `generate_chunk_voxels`, calculate the 2D data once for the $16 \times 16$ chunk footprint.
```rust
struct TerrainColumn {
    terrain_height: i32,
    biome: Biome,
    water: WaterGenerationMetadata,
}
```
Cache this in an array of 256 columns. The `Y` loop will then just read from this cached column data.

### Step 2: Implement "Forward" Tree Bounds Checking
Instead of every voxel searching outward for trees, the chunk generation should find all trees that overlap the chunk *once*.
1. Define a bounding box: `chunk_bounds + TREE_LEAF_CHECK_RADIUS`.
2. Iterate over this $22 \times 22$ 2D footprint.
3. Run `get_height` and `should_spawn_tree`. If a tree exists, store it in a local `Vec<LocalTree>`.
4. During the voxel `Y` loop, if the voxel is above ground, simply check if its `(x,y,z)` falls within the bounding box of any `LocalTree` in the list.

### Step 3: Implement `Chunk::with_voxels` Fast Path
Add a constructor to `Chunk` that accepts a flat `[VoxelType; CHUNK_VOLUME]` array. 
`generate_chunk_async` can then populate a local primitive array and instantiate the `Chunk` with the flags correctly pre-configured, bypassing `chunk.set()`.
