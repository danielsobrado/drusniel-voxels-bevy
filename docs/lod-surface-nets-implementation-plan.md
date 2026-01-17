# LOD System Implementation Plan: Simplified Surface Nets for Distant Chunks

## Executive Summary

This document details the implementation plan for a proper Level-of-Detail (LOD) system that uses simplified Surface Nets meshes (via larger voxel step sizes) for distant chunks instead of the current approach where both High and Low LOD use identical meshes.

**Current Problem:**
- Both `LodLevel::High` and `LodLevel::Low` generate identical Surface Nets meshes
- No actual geometry reduction occurs at distance
- Performance bottleneck: all visible chunks have the same vertex count

**Proposed Solution:**
- Use downsampled SDF grids for Low LOD chunks (step size 2 = sample every 2nd voxel)
- Reduces vertex count by approximately 75% for distant chunks
- Maintains visual coherence using the same Surface Nets algorithm

---

## Current Architecture Analysis

### Existing LOD System (plugin.rs)

```rust
pub struct LodSettings {
    pub high_detail_distance: f32,  // 160.0 units
    pub cull_distance: f32,         // 400.0 units
    pub low_detail_mode: MeshMode,  // Currently: MeshMode::SurfaceNets
}

pub enum LodLevel {
    High,    // < 160 units from camera
    Low,     // 160-400 units from camera
    Culled,  // > 400 units (no mesh)
}
```

### Current Surface Nets Implementation (meshing.rs)

The current implementation uses a fixed 18x18x18 padded grid:

```rust
type PaddedChunkShape = ConstShape3u32<18, 18, 18>;  // For 16x16x16 chunks

fn generate_sdf(chunk: &Chunk, world: &VoxelWorld) -> [f32; 5832] {
    // Samples every voxel position (step size = 1)
    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        let is_solid = sample_voxel_solid(...);
        sdf[i] = if is_solid { -1.0 } else { 1.0 };
    }
}

surface_nets(&sdf, &PaddedChunkShape {}, [0; 3], [17; 3], &mut buffer);
```

---

## Proposed Implementation

### Phase 1: Core Infrastructure

#### 1.1 Define LOD Grid Configurations

Add new constants and types for multi-resolution SDF grids:

```rust
// In constants.rs

/// LOD 0 (High): Full resolution - 18x18x18 padded grid, step size 1
pub const LOD0_PADDED_SIZE: u32 = 18;
pub const LOD0_STEP_SIZE: u32 = 1;
pub const LOD0_GRID_VOLUME: usize = 5832;  // 18^3

/// LOD 1 (Low): Half resolution - 10x10x10 padded grid, step size 2
/// For 16x16x16 chunks: (16/2) + 2 padding = 10
pub const LOD1_PADDED_SIZE: u32 = 10;
pub const LOD1_STEP_SIZE: u32 = 2;
pub const LOD1_GRID_VOLUME: usize = 1000;  // 10^3

/// LOD 2 (Very Low, optional): Quarter resolution - 6x6x6 grid, step size 4
pub const LOD2_PADDED_SIZE: u32 = 6;
pub const LOD2_STEP_SIZE: u32 = 4;
pub const LOD2_GRID_VOLUME: usize = 216;  // 6^3
```

#### 1.2 Create Parameterized SDF Generator

```rust
// In meshing.rs

/// Generates an SDF grid at the specified resolution.
///
/// # Arguments
/// * `chunk` - The chunk to generate SDF for
/// * `world` - World for cross-chunk sampling
/// * `step_size` - Voxel sampling interval (1 = every voxel, 2 = every other, etc.)
/// * `padded_size` - Size of the padded output grid
///
/// # Returns
/// SDF values as a flat array sized for the target resolution
fn generate_sdf_with_step<const SIZE: usize>(
    chunk: &Chunk,
    world: &VoxelWorld,
    step_size: u32,
    padded_size: u32,
) -> [f32; SIZE] {
    let mut sdf = [1.0f32; SIZE];
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    for z in 0..padded_size {
        for y in 0..padded_size {
            for x in 0..padded_size {
                let idx = (z * padded_size * padded_size + y * padded_size + x) as usize;

                // Map grid position to world position (accounting for step size)
                // Grid position 0 = padding, position 1..N-1 = chunk interior
                let world_x = chunk_origin.x + ((x as i32 - 1) * step_size as i32);
                let world_y = chunk_origin.y + ((y as i32 - 1) * step_size as i32);
                let world_z = chunk_origin.z + ((z as i32 - 1) * step_size as i32);

                let is_solid = sample_voxel_at_world_pos(world, IVec3::new(world_x, world_y, world_z));
                sdf[idx] = if is_solid { -1.0 } else { 1.0 };
            }
        }
    }

    sdf
}
```

#### 1.3 Create LOD-Aware Mesh Generator

```rust
// In meshing.rs

/// Configuration for LOD mesh generation
#[derive(Clone, Copy, Debug)]
pub struct LodMeshConfig {
    pub step_size: u32,
    pub padded_size: u32,
}

impl LodMeshConfig {
    pub const HIGH: Self = Self { step_size: 1, padded_size: 18 };
    pub const LOW: Self = Self { step_size: 2, padded_size: 10 };
    pub const VERY_LOW: Self = Self { step_size: 4, padded_size: 6 };
}

/// Generates chunk mesh at specified LOD resolution
pub fn generate_chunk_mesh_surface_nets_lod(
    chunk: &Chunk,
    world: &VoxelWorld,
    lod_config: LodMeshConfig,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    ao_config: &BakedAoConfig,
) -> ChunkMeshResult {
    let step = lod_config.step_size;
    let padded = lod_config.padded_size;

    // Generate appropriately-sized SDF
    let sdf = match padded {
        18 => generate_sdf_with_step::<5832>(chunk, world, step, padded),
        10 => generate_sdf_with_step::<1000>(chunk, world, step, padded),
        6 => generate_sdf_with_step::<216>(chunk, world, step, padded),
        _ => panic!("Unsupported LOD grid size"),
    };

    // Run surface nets on the downsampled grid
    let shape = DynamicShape3::new(padded, padded, padded);
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(&sdf, &shape, [0; 3], [padded - 1; 3], &mut buffer);

    // CRITICAL: Scale vertex positions by step_size to match chunk dimensions
    for pos in buffer.positions.iter_mut() {
        pos[0] = (pos[0] - 1.0) * step as f32;  // -1 removes padding offset
        pos[1] = (pos[1] - 1.0) * step as f32;
        pos[2] = (pos[2] - 1.0) * step as f32;
    }

    // Continue with normal mesh assembly...
    assemble_mesh_from_buffer(buffer, chunk, world, ...)
}
```

### Phase 2: Integration with LOD System

#### 2.1 Update mesh_dirty_chunks_system

```rust
// In plugin.rs

fn mesh_dirty_chunks_system(...) {
    for chunk_pos in dirty_chunks {
        let lod_level = chunk.lod_level();

        // Select LOD configuration based on distance
        let lod_config = match lod_level {
            LodLevel::High => LodMeshConfig::HIGH,   // Step 1, 18x18x18
            LodLevel::Low => LodMeshConfig::LOW,     // Step 2, 10x10x10
            LodLevel::Culled => continue,            // Don't mesh
        };

        let mesh_result = generate_chunk_mesh_surface_nets_lod(
            chunk,
            &world,
            lod_config,
            lod_level,
            neighbor_lods,
            &skirt_config,
            &ao_config,
        );

        // ... rest of mesh handling
    }
}
```

#### 2.2 Handle LOD Transitions

When a chunk transitions between LOD levels, it must be re-meshed:

```rust
// Already handled in update_chunk_lod_system - chunks are marked dirty on LOD change
fn update_chunk_lod_system(...) {
    if chunk.set_lod_level(target_lod) {
        // Chunk LOD changed - already marks dirty and triggers remesh
        lod_changed.push(*chunk_pos);
    }
}
```

### Phase 3: Dynamic Shape Support

The `fast-surface-nets` crate requires compile-time shape sizes. To support multiple LOD levels, implement runtime shape selection:

#### 3.1 Shape Type Aliases

```rust
use ndshape::{ConstShape, ConstShape3u32};

// Compile-time shapes for each LOD level
type LodShape0 = ConstShape3u32<18, 18, 18>;  // High detail
type LodShape1 = ConstShape3u32<10, 10, 10>;  // Low detail
type LodShape2 = ConstShape3u32<6, 6, 6>;     // Very low detail
```

#### 3.2 LOD-Specific Function Variants

Since `surface_nets` is generic over the shape, create separate functions:

```rust
fn generate_sdf_lod0(chunk: &Chunk, world: &VoxelWorld) -> [f32; 5832] {
    generate_sdf_with_step_impl::<LodShape0, 5832>(chunk, world, 1)
}

fn generate_sdf_lod1(chunk: &Chunk, world: &VoxelWorld) -> [f32; 1000] {
    generate_sdf_with_step_impl::<LodShape1, 1000>(chunk, world, 2)
}

fn mesh_surface_nets_lod0(...) -> ChunkMeshResult {
    let sdf = generate_sdf_lod0(chunk, world);
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(&sdf, &LodShape0 {}, [0; 3], [17; 3], &mut buffer);
    // Scale factor = 1.0 (no scaling needed)
    ...
}

fn mesh_surface_nets_lod1(...) -> ChunkMeshResult {
    let sdf = generate_sdf_lod1(chunk, world);
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(&sdf, &LodShape1 {}, [0; 3], [9; 3], &mut buffer);
    // Scale factor = 2.0 (double vertex positions)
    for pos in buffer.positions.iter_mut() {
        pos[0] = (pos[0] - 1.0) * 2.0;
        pos[1] = (pos[1] - 1.0) * 2.0;
        pos[2] = (pos[2] - 1.0) * 2.0;
    }
    ...
}
```

### Phase 4: Material and AO Adjustments

#### 4.1 Material Weights at Lower Resolution

At lower LOD, material weight sampling needs to cover a larger area:

```rust
fn compute_vertex_material_weights_lod(
    local_pos: Vec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    step_size: u32,
) -> [f32; 4] {
    let mut weights = [0.0f32; 4];
    let mut total_weight = 0.0;

    // Sample a larger area for lower LOD levels
    let sample_radius = step_size as i32;

    for dz in -sample_radius..=sample_radius {
        for dy in -sample_radius..=sample_radius {
            for dx in -sample_radius..=sample_radius {
                // Sample voxel and accumulate material weights
                ...
            }
        }
    }

    normalize_weights(weights)
}
```

#### 4.2 Simplified AO for Low LOD

Consider disabling or simplifying AO for distant chunks:

```rust
fn mesh_surface_nets_lod1(...) -> ChunkMeshResult {
    // Skip AO computation for low LOD - it's barely visible at distance
    let ao_config_override = BakedAoConfig {
        enabled: false,
        ..ao_config.clone()
    };
    ...
}
```

---

## Performance Analysis

### Vertex Count Reduction

| LOD Level | Grid Size | Step Size | Approx. Vertices | Reduction |
|-----------|-----------|-----------|------------------|-----------|
| High      | 18x18x18  | 1         | 100%             | -         |
| Low       | 10x10x10  | 2         | ~25%             | 75%       |
| Very Low  | 6x6x6     | 4         | ~6%              | 94%       |

### Memory Impact

| LOD Level | SDF Array Size | Buffer Size |
|-----------|----------------|-------------|
| High      | 5,832 floats   | ~23 KB      |
| Low       | 1,000 floats   | ~4 KB       |
| Very Low  | 216 floats     | ~1 KB       |

### Expected Performance Gains

With 400-unit cull distance covering a 512x512 world:
- ~50% of visible chunks are at Low LOD
- 75% vertex reduction for Low LOD chunks
- **Estimated total vertex reduction: 35-40%**

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add LOD grid constants to `constants.rs`
- [ ] Create `LodMeshConfig` struct
- [ ] Implement `generate_sdf_with_step` generic function
- [ ] Add compile-time shape types for each LOD level

### Phase 2: Mesh Generation
- [ ] Create `mesh_surface_nets_lod0` (existing, refactored)
- [ ] Create `mesh_surface_nets_lod1` (new, step size 2)
- [ ] Implement vertex position scaling
- [ ] Handle boundary edge extraction at different resolutions

### Phase 3: Integration
- [ ] Update `mesh_dirty_chunks_system` to use LOD-aware meshing
- [ ] Verify LOD transition handling
- [ ] Update skirt generation for LOD boundaries

### Phase 4: Optimization
- [ ] Simplify AO for Low LOD chunks
- [ ] Adjust material weight sampling for lower resolution
- [ ] Profile and measure actual performance gains

### Phase 5: Quality Assurance
- [ ] Visual testing at LOD boundaries
- [ ] Verify no seams between High and Low LOD chunks
- [ ] Test with different camera positions
- [ ] Benchmark meshing times per LOD level

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Seams at LOD boundaries | High | Use consistent boundary vertex positions; skirts already help |
| Visual popping on LOD transition | Medium | Consider blending or distance hysteresis |
| Material weight artifacts | Low | Sample larger area at lower LOD |
| AO discontinuities | Low | Disable AO for Low LOD entirely |

---

## Alternative Approaches Considered

### 1. Mesh Simplification (Rejected)
Generate full-resolution mesh then simplify with decimation algorithms.
- **Pros**: Single mesh generation path
- **Cons**: CPU overhead, complex implementation, harder to control

### 2. Greedy Meshing for Low LOD (Rejected)
Switch to blocky meshing for distant chunks.
- **Pros**: Simple, fast
- **Cons**: Visual discontinuity (already tried, looks bad)

### 3. GPU Tessellation (Future Enhancement)
Generate base mesh, use GPU tessellation for detail.
- **Pros**: Dynamic, smooth
- **Cons**: Shader complexity, WGPU support limitations

---

## Files to Modify

1. **src/constants.rs** - Add LOD grid constants
2. **src/voxel/meshing.rs** - Core LOD mesh generation
3. **src/voxel/plugin.rs** - Integration with LOD system
4. **src/voxel/skirt.rs** - Boundary handling for different resolutions
5. **src/voxel/baked_ao.rs** - AO simplification for low LOD

---

## Success Metrics

1. **Performance**: 30%+ reduction in total mesh vertex count
2. **Visual Quality**: No visible seams at LOD boundaries
3. **Stability**: No crashes or artifacts during LOD transitions
4. **Meshing Time**: Low LOD meshing should be 3-4x faster than High LOD
