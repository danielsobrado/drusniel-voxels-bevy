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

### Phase 1: Core Infrastructure ✅ COMPLETE
- [x] Add LOD grid constants to `constants.rs`
- [x] Create `LodMeshConfig` struct
- [x] Implement `generate_sdf_lod1` function (half resolution sampling)
- [x] Add compile-time shape types for each LOD level (`LodShape1`)

### Phase 2: Mesh Generation ✅ COMPLETE
- [x] `generate_chunk_mesh_surface_nets` handles high detail (existing)
- [x] Create `generate_chunk_mesh_surface_nets_lod1` (step size 2)
- [x] Implement vertex position scaling (multiply by step_size)
- [x] Handle boundary edge extraction at different resolutions

### Phase 3: Integration ✅ COMPLETE
- [x] Update `generate_chunk_mesh_with_mode` for LOD-aware meshing
- [x] Implement LOD transition hysteresis (`calculate_target_lod_with_hysteresis`)
- [x] Update skirt generation for LOD boundaries
- [x] Priority-based dirty chunk processing (nearest first)
- [x] Per-frame mesh throttling (`MAX_CHUNKS_PER_FRAME = 16`)

### Phase 4: Optimization ✅ COMPLETE
- [x] Simplify AO for Low LOD chunks (disabled - `ao = 1.0`)
- [x] Adjust material weight sampling (`compute_vertex_material_weights_lod`)
- [x] Vertex count tracking for measuring LOD effectiveness
- [x] Per-chunk average statistics for verifying 75% reduction

### Phase 5: Quality Assurance 🔄 IN PROGRESS
- [ ] Visual testing at LOD boundaries
- [ ] Verify no seams between High and Low LOD chunks
- [ ] Test with different camera positions
- [x] Meshing time tracking in debug overlay

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

## Bevy-Specific Optimizations

### Parallel Mesh Generation

Mesh generation is CPU-heavy and independent per chunk - ideal for parallelization:

```rust
// In mesh_dirty_chunks_system - spawn async tasks

use bevy::tasks::{AsyncComputeTaskPool, Task};

#[derive(Component)]
struct MeshGenerationTask {
    task: Task<ChunkMeshResult>,
    chunk_pos: IVec3,
    lod_level: LodLevel,
}

fn spawn_mesh_tasks(
    mut commands: Commands,
    world: Res<VoxelWorld>,
    dirty_chunks: Query<(Entity, &ChunkPosition), With<DirtyChunk>>,
    camera: Query<&Transform, With<PlayerCamera>>,
) {
    let task_pool = AsyncComputeTaskPool::get();
    let camera_pos = camera.single().translation;

    // Sort by distance - prioritize near chunks
    let mut chunks: Vec<_> = dirty_chunks.iter().collect();
    chunks.sort_by(|a, b| {
        let dist_a = camera_pos.distance(a.1.world_center());
        let dist_b = camera_pos.distance(b.1.world_center());
        dist_a.partial_cmp(&dist_b).unwrap()
    });

    // Throttle: only spawn N tasks per frame to avoid overwhelming CPU
    const MAX_TASKS_PER_FRAME: usize = 8;

    for (entity, chunk_pos) in chunks.into_iter().take(MAX_TASKS_PER_FRAME) {
        let chunk_data = world.get_chunk(chunk_pos.0).clone();
        let lod_config = determine_lod_config(chunk_pos, camera_pos);

        let task = task_pool.spawn(async move {
            generate_surface_nets_lod(&chunk_data, lod_config)
        });

        commands.entity(entity).insert(MeshGenerationTask {
            task,
            chunk_pos: chunk_pos.0,
            lod_level: lod_config.level,
        });
    }
}

fn poll_mesh_tasks(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut tasks: Query<(Entity, &mut MeshGenerationTask)>,
) {
    for (entity, mut task) in tasks.iter_mut() {
        if let Some(result) = block_on(poll_once(&mut task.task)) {
            // Apply mesh on main thread (fast)
            let mesh_handle = meshes.add(result.solid.into_mesh());
            commands.entity(entity)
                .insert(Mesh3d(mesh_handle))
                .remove::<MeshGenerationTask>();
        }
    }
}
```

### LOD Transition Hysteresis

Prevent rapid LOD switching when camera is near threshold:

```rust
/// Hysteresis buffer to prevent LOD flip-flopping
const LOD_HYSTERESIS: f32 = 10.0;

fn calculate_target_lod(
    distance: f32,
    current_lod: LodLevel,
    settings: &LodSettings,
) -> LodLevel {
    match current_lod {
        LodLevel::High => {
            // Need to go PAST threshold + hysteresis to switch to Low
            if distance > settings.high_detail_distance + LOD_HYSTERESIS {
                LodLevel::Low
            } else {
                LodLevel::High
            }
        }
        LodLevel::Low => {
            // Need to come INSIDE threshold - hysteresis to switch to High
            if distance < settings.high_detail_distance - LOD_HYSTERESIS {
                LodLevel::High
            } else if distance > settings.cull_distance + LOD_HYSTERESIS {
                LodLevel::Culled
            } else {
                LodLevel::Low
            }
        }
        LodLevel::Culled => {
            if distance < settings.cull_distance - LOD_HYSTERESIS {
                LodLevel::Low
            } else {
                LodLevel::Culled
            }
        }
    }
}
```

### Entity Management for Culled Chunks

Despawn culled chunk entities to reduce ECS overhead:

```rust
fn manage_culled_chunks(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    chunks: Query<(Entity, &ChunkMesh)>,
) {
    for (entity, chunk_mesh) in chunks.iter() {
        if let Some(chunk) = world.get_chunk(chunk_mesh.chunk_position) {
            if chunk.lod_level() == LodLevel::Culled {
                // Despawn the mesh entity entirely
                commands.entity(entity).despawn();

                // Clear references in chunk data
                if let Some(chunk_mut) = world.get_chunk_mut(chunk_mesh.chunk_position) {
                    chunk_mut.clear_mesh_entity();
                    chunk_mut.clear_water_mesh_entity();
                }
            }
        }
    }
}
```

### Super-Chunking (Future Enhancement)

For further draw call reduction, merge distant chunks:

```rust
/// Groups 4x4 Low LOD chunks into a single mesh
/// Reduces draw calls from 16 to 1 for that region
struct SuperChunk {
    /// Which 4x4 region this represents (in chunk coordinates / 4)
    region: IVec2,
    /// Combined mesh of all 16 chunks
    mesh_entity: Option<Entity>,
    /// LOD level (only created when all 16 chunks are Low LOD)
    active: bool,
}

fn update_super_chunks(
    world: &VoxelWorld,
    super_chunks: &mut HashMap<IVec2, SuperChunk>,
) {
    // For each 4x4 region, check if all chunks are Low LOD
    // If so, combine meshes and disable individual chunk meshes
    // If any chunk becomes High LOD, dissolve super-chunk
}
```

---

## Alternative LOD Techniques Comparison

### Why Not These Approaches?

| Technique | Pros | Cons | Verdict |
|-----------|------|------|---------|
| **Octree Dual Contouring** | Preserves sharp features, adaptive detail | Complex implementation, major rewrite needed | Too invasive for our existing pipeline |
| **Transvoxel** | Seamless transitions by design | Designed for Marching Cubes, not Surface Nets | Not directly applicable |
| **Geometry Clipmaps** | Great for heightfield terrain | Poor for true 3D volumes (caves, overhangs) | Wrong fit for volumetric world |
| **Mesh Decimation** | Optimal triangle reduction | Too slow for real-time, breaks seams | Rejected for dynamic terrain |
| **Greedy Meshing (Low LOD)** | Very fast, huge polygon reduction | Visual discontinuity (blocky vs smooth) | Already tried, looks bad |
| **Impostors** | Extreme distance optimization | Fails for 3D parallax | Maybe for >1000 unit distance |

### Chosen Approach Rationale

Downsampled voxel grids for Surface Nets is the **simplest effective method** because:
1. Leverages existing voxel representation (8 voxels → 1 at distance)
2. Same algorithm produces consistent visual style
3. No complex transition geometry needed (skirts suffice)
4. Easy to implement incrementally
5. Tunable via distance thresholds

---

## GPU Meshing (Future Enhancement)

For extreme performance, consider compute shader mesh generation:

```wgsl
// Conceptual WGSL compute shader for Surface Nets
@group(0) @binding(0) var<storage, read> voxel_data: array<u32>;
@group(0) @binding(1) var<storage, read_write> vertices: array<Vertex>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;

@compute @workgroup_size(8, 8, 8)
fn surface_nets_compute(
    @builtin(global_invocation_id) id: vec3<u32>
) {
    // Each thread processes one voxel cell
    let sdf = sample_sdf_neighborhood(id);
    if has_sign_change(sdf) {
        let vertex = compute_vertex_position(sdf);
        let idx = atomicAdd(&vertex_count, 1u);
        vertices[idx] = vertex;
    }
}
```

**Benefits:**
- Massive parallelism (thousands of threads)
- Frees CPU for game logic
- Direct GPU buffer output (no upload needed)

**Challenges:**
- Complex shader code
- Debugging difficulty
- WGPU compute shader limitations
- Read-back needed if CPU requires mesh data

**Recommendation:** Implement CPU LOD first, profile, then consider GPU if CPU becomes bottleneck.

---

## Success Metrics

1. **Performance**: 30%+ reduction in total mesh vertex count
2. **Visual Quality**: No visible seams at LOD boundaries
3. **Stability**: No crashes or artifacts during LOD transitions
4. **Meshing Time**: Low LOD meshing should be 3-4x faster than High LOD
5. **Scalability**: System handles rapid camera movement without hitching
6. **Draw Calls**: Maintain reasonable draw call count with many visible chunks
