# Shallow Water Waves Fix

## Issue Description

Shallow terrain water showed wave effects at **far distances** but waves **disappeared when close**. This appeared to be inverted behavior - waves should be more visible up close, not less.

## Investigation Process

### Initial Hypothesis (Incorrect)
Initially suspected the water material LOD system was inverting behavior:
- Near (<64 units): `StandardWaterMaterial` with wave shader
- Far (>64 units): `StandardMaterial` without waves

However, the user confirmed waves were **animated** at distance, not just specular reflections.

### Key Discovery

The user observed that waves only appeared at **terrain LOD boundaries** - specifically, water in LOD1 chunks showed waves while water in LOD0 chunks did not.

### Root Cause Found

**Water mesh UVs were using atlas texture coordinates instead of world-space coordinates.**

In `src/voxel/meshing.rs`, the `add_face_no_ao()` function generated UVs pointing to the water tile in the texture atlas:

```rust
// OLD CODE - Atlas UVs (wrong for waves)
let atlas_idx = voxel.atlas_index();
let col = (atlas_idx % ATLAS_COLUMNS as u8) as f32;
let row = (atlas_idx / ATLAS_COLUMNS as u8) as f32;
let u_min = col / cols + UV_PADDING;  // ~0.0 to ~0.06
let u_max = (col + 1.0) / cols - UV_PADDING;
```

The wave shader calculates wave height from UV coordinates:

```wgsl
// water_functions.wgsl
fn uv_to_coord(uv: vec2<f32>) -> vec2<f32> {
    return material.coord_offset + (uv * material.coord_scale);
}

fn get_wave_height(p: vec2<f32>) -> f32 {
    // Uses p (from UVs) to calculate wave position
}
```

With atlas UVs (~0.0 to ~0.06) multiplied by `coord_scale` (6.5):
- All water vertices got wave coordinates in range **0 to ~0.4**
- This tiny range meant **virtually no wave variation** across the entire water surface

## Solution

### 1. Created `add_water_face()` Function

New function in `src/voxel/meshing.rs` that uses **world-space XZ coordinates** as UVs:

```rust
fn add_water_face(
    mesh_data: &mut MeshData,
    local: UVec3,
    face: Face,
    chunk_origin: IVec3,  // Added to calculate world position
) {
    // ... vertex generation ...

    // World-space UVs for wave calculation
    let world_x = chunk_origin.x as f32 + x;
    let world_z = chunk_origin.z as f32 + z;

    let (uv0, uv1, uv2, uv3) = match face {
        Face::Top | Face::Bottom => (
            [world_x, world_z + s],
            [world_x + s, world_z + s],
            [world_x + s, world_z],
            [world_x, world_z],
        ),
        // ... other faces use appropriate world coords
    };
}
```

### 2. Updated `generate_water_mesh()`

Changed to call `add_water_face()` instead of `add_face_no_ao()`:

```rust
fn generate_water_mesh(
    chunk: &Chunk,
    world: &VoxelWorld,
    _chunk_center: Vec3,
    chunk_origin: IVec3,  // Now used
) -> MeshData {
    // ...
    add_water_face(&mut water_mesh, local, Face::Top, chunk_origin);
    // ...
}
```

### 3. Adjusted Constants

In `src/constants.rs`:

| Constant | Old Value | New Value | Reason |
|----------|-----------|-----------|--------|
| `VOXEL_WATER_WAVE_UV_SCALE` | 6.5 | 0.1 | UVs are now world coords (0-1000+), not atlas coords (0-1) |
| `VOXEL_WATER_WAVE_AMPLITUDE_MULT` | 1.6 | 4.0 | Increased significantly for visible vertex displacement |
| `WATER_FANCY_MIN_TRIANGLES` | 50 | 1 | Allow small water patches to use wave shader |
| `WATER_FANCY_MIN_DEPTH` | 1 | 0 | Allow shallow water to use wave shader |

### 4. Shader Adjustment

In `assets/shaders/water_fragment.wgsl`, reduced shallow color blend:

```wgsl
// Reduced from 0.85 to 0.3 to let wave lighting show through
water_color = vec4<f32>(mix(water_color.rgb, shallow_color.rgb, 0.3), 1.0);
```

## Files Modified

1. `src/voxel/meshing.rs` - Added `add_water_face()`, updated `generate_water_mesh()`
2. `src/constants.rs` - Adjusted wave UV scale, amplitude, and LOD thresholds
3. `assets/shaders/water_fragment.wgsl` - Reduced shallow color blend

## Final Tuning

After initial fix, waves were animating but not fully visible. Applied additional tuning:
- Increased `VOXEL_WATER_WAVE_AMPLITUDE_MULT` from 2.0 to 4.0
- Reduced shallow color blend from 0.5 to 0.3

These values can be adjusted in the future for different visual styles.

## Technical Details

### Wave Coordinate Flow

1. **Mesh Generation**: Water vertex gets UV = world XZ position (e.g., `[150.0, 230.0]`)
2. **Vertex Shader**: `uv_to_coord(uv)` → `coord_offset + (uv * coord_scale)` → `[15.0, 23.0]` (with scale 0.1)
3. **Wave Function**: `get_wave_height(p)` calculates height from these coordinates
4. **Vertex Displacement**: `world_position + (normal * height)`

### Why LOD1 Showed Waves Before

This remains partially unclear. Possible explanations:
- LOD1 chunks may have been created at different times with different camera positions
- The material LOD system may have had timing issues
- Visual perception at distance may have made subtle waves more apparent
