# Chunk Seam Fix - Surface Nets Boundary Alignment

## The Problem

Dark cracks/seams were visible at chunk boundaries in the smooth terrain mesh. These appeared as thin dark lines where adjacent chunk meshes didn't connect properly.

## Root Cause

Surface Nets generates mesh vertices by interpolating SDF (Signed Distance Field) values. For adjacent chunks to produce identical vertices at their shared boundary, they must calculate **identical SDF values** for boundary voxels.

Two issues were causing misaligned boundary vertices:

### 1. SDF Smoothing

The `smooth_sdf_boundaries()` function was smoothing SDF values by averaging with neighbors. This smoothing operated independently per chunk, causing each chunk to calculate slightly different SDF values at boundaries.

**Before:**
```rust
// Second pass: smooth SDF values at boundaries (0.5 = equal blend)
smooth_sdf_boundaries(&sdf, 0.5)
```

**After:**
```rust
// Skip smoothing - it causes boundary vertices to differ between chunks, creating seams.
// The raw binary SDF produces consistent boundary vertices across chunks.
sdf
```

### 2. Chunk Center Scaling

The `scale_vertex_from_center()` function was scaling vertices outward from each chunk's center to try to close gaps. However, at chunk boundaries, the same world-space vertex exists in two chunks, each with a different center. Scaling from different centers produced different final positions.

**Before:**
```rust
pub const CHUNK_BOUNDARY_SCALE: f32 = 1.02;
```

**After:**
```rust
pub const CHUNK_BOUNDARY_SCALE: f32 = 1.0;  // No scaling
```

## The Solution

1. **Disable SDF smoothing** - Use raw binary SDF values (-1 for solid, +1 for air) so both chunks sample the same world voxels and get identical values at boundaries.

2. **Disable boundary scaling** - Set `CHUNK_BOUNDARY_SCALE` to 1.0 so vertices aren't transformed differently in adjacent chunks.

## Why Raw Binary SDF Works

With binary SDF values:
- Each chunk samples voxels from the world (including padding from neighbors)
- Boundary voxels sample the exact same world positions in both chunks
- Surface Nets interpolates between -1 and +1, producing vertices at exactly x=0.5 on the boundary
- Both chunks produce identical vertex positions

## Key Files Changed

- `src/voxel/meshing.rs` - Disabled SDF smoothing in `generate_sdf()` and `generate_water_sdf()`
- `src/constants.rs` - Set `CHUNK_BOUNDARY_SCALE` to 1.0

## Alternative Solutions Considered

1. **Skirts** - Add geometry that extends downward from boundary edges. Already implemented for LOD transitions but doesn't fix horizontal gaps.

2. **Boundary-aware smoothing** - Only smooth interior cells (2-15), leaving boundary cells (1, 16) unsmoothed. Tried but didn't fully fix the issue.

3. **Transvoxel algorithm** - Special transition meshes for LOD stitching. More complex to implement.

## References

- [Smooth Voxel Mapping - Technical Deep Dive](https://bonsairobo.medium.com/smooth-voxel-mapping-a-technical-deep-dive-on-real-time-surface-nets-and-texturing-ef06d0f8ca14)
- [0fps - Smooth Voxel Terrain Part 2](https://0fps.net/2012/07/12/smooth-voxel-terrain-part-2/)
- [GameDev.net - Closing cracks between chunks](https://www.gamedev.net/forums/topic/677141-closing-cracks-between-neighboring-chunks-with-different-lods-in-a-non-cubical-voxel-terrain/)
