# Deep Voxel Terrain System: Complete Technical Guide for Bevy

Document status (2026-05-17): current technical note; verify file paths against code when editing.

**Bottom Line**: Building a 64-depth diggable voxel terrain with caves, bedrock, and water compatibility in Bevy requires a **hybrid collision approach** (voxel grid broadphase + trimesh narrowphase), **vertically-stacked 16^3 chunk sections** with palette compression, and **noise-based cave generation** that respects water table boundaries. Valheim's heightmap approach won't work for deep caves -- you need true 3D voxel storage. Expect **10-20MB terrain memory** for a 256x64x256 loaded area, with mesh generation at **50-200 microseconds per chunk** using optimized greedy meshing.

---

## Valheim uses heightmaps, not voxels -- here's why that matters

Valheim runs on Unity with a **heightmap-based terrain** system, fundamentally different from what you need. The game stores terrain as a 2D height grid with a **TerrainModifier object system** that tracks player changes as delta values from the original generated height. Each modification is capped at **+/-8 meters** from the original terrain level -- this isn't bedrock, it's a software limit to keep distant LOD consistent with modified terrain.

The water implementation is elegantly simple: a **single global plane at Y=30** covering the entire world. Rivers and lakes are just terrain dipping below this plane. Waves (Y=28 to Y=34) are purely visual, passing through geometry during storms. This explains why Valheim has no waterfalls -- the system cannot support variable water heights.

**Why this doesn't work for your project**: Heightmaps store only one Y value per XZ coordinate, making true caves and overhangs impossible. For a Minecraft-like 64-depth system with caves, you need **volumetric voxel storage** where each 3D position can be solid or empty independently.

---

## Commercial games reveal three distinct collision philosophies

Analyzing Minecraft, Deep Rock Galactic, Astroneer, and Teardown reveals a spectrum of collision approaches, each with clear tradeoffs:

**Minecraft's AABB grid collision** achieves O(1) lookup by transforming entity positions directly to voxel coordinates, querying only overlapping voxels, and resolving movement axis-by-axis. This prevents getting stuck inside geometry -- a critical insight. The system uses **swept AABB** collision, limiting movement to the nearest blocking face distance per axis. No physics engine is involved; it's all custom code against the block grid.

**Deep Rock Galactic and Astroneer** use **generated mesh colliders** from their voxel data. Deep Rock employs Marching Cubes on Unreal Engine 4, regenerating collision meshes whenever terrain is destroyed. Astroneer uses a voxel density field (SDF-like) with chunk polygonization rebuilding both visual and collision meshes on modification. Both accept the CPU cost of mesh cooking for smooth terrain aesthetics.

**Teardown** takes a unique approach: **voxel-vs-voxel collision on CPU** with no triangles in physics at all. Everything is volumetric data, with 10cm voxel resolution and custom C++ collision code. This works because Teardown's voxels are small and dense.

| Game | Data Structure | Collision Approach | Depth/Bedrock |
|------|---------------|-------------------|---------------|
| Minecraft | 16^3 sections, palette-compressed | AABB per block (O(1) lookup) | Y=-64 to Y=320; 5-layer probabilistic bedrock |
| Deep Rock Galactic | Voxel grid + Marching Cubes | UE4 mesh colliders, regenerated on change | Compressed Granite sphere boundary |
| Astroneer | Voxel density field (SDF) | Per-chunk mesh colliders | Hollow planetary cores, no bedrock |
| 7 Days to Die | Custom voxel + Marching Cubes | Unity physics with structural integrity | Bedrock at world bottom |

---

## Collision performance demands a hybrid architecture

For Surface Nets smooth terrain, you cannot use simple AABB collision like Minecraft -- the mesh doesn't align to a grid. However, full trimesh collision has significant overhead.

**The critical numbers from Roblox's engineering**: Building a BVH (Bounding Volume Hierarchy) for trimesh collision is **3-5x more expensive than mesh generation itself**. Non-quantized Bullet BVH uses ~128 bytes per triangle, while quantized drops to ~32 bytes. Roblox's custom kD-tree achieves ~12 bytes per triangle. The Godot Voxel Tools team confirms that "collision generation slows down terrain loading tremendously."

**Recommended hybrid architecture for Surface Nets**:

```
┌─────────────────────────────────────────────┐
│ Broadphase: Dilated voxel bitmask           │
│   - 1 bit per voxel indicating "has geometry"│
│   - Test 64 voxels with single 64-bit mask  │
│   - Early reject 90%+ of potential contacts │
└─────────────────────────────────────────────┘
              │ (candidate pairs)
              ▼
┌─────────────────────────────────────────────┐
│ Narrowphase: Lazy-loaded trimesh per chunk  │
│   - Generate only for chunks with contacts  │
│   - Cache with LRU eviction (100-500 meshes)│
│   - Use kD-tree, not BVH (lower memory)     │
└─────────────────────────────────────────────┘
```

**Rapier-specific guidance**: Use `Collider::trimesh_with_flags(vertices, indices, TriMeshFlags::FIX_INTERNAL_EDGES)` to prevent ghost collisions at internal triangle edges. For terrain surfaces without caves, `Collider::heightfield()` uses significantly less memory. Rapier now supports native voxel shapes via `Collider::voxels()` for blocky collision -- consider this for a coarse collision layer.

---

## Vertical chunk stacking solves deep terrain efficiently

Minecraft's post-1.18 architecture provides the blueprint: **16x16x16 sections** stacked vertically within chunk columns. The Overworld spans Y=-64 to Y=320 (384 blocks) using 24 sections. Your 64-depth world needs only **4 sections** vertically.

**Empty sections consume near-zero memory** -- only a single palette entry stating "all air" or "all stone." This is crucial for underground optimization: most cave-free underground sections store just 4 bytes each.

**Palette compression** dramatically reduces memory:
- Single-valued sections (uniform material): ~4 bytes total
- Sparse sections (<=16 unique blocks): 4-bit indices -> **2KB**
- Highly varied sections: 15-bit indices -> ~7.5KB maximum

For Surface Nets, you need the **18^3 boundary** pattern: each 16^3 section's mesh generation requires 1-voxel padding from all 6 neighbors to create seamless chunk boundaries. Store this overlap data or fetch it during meshing.

**Memory estimates for 256x64x256 loaded area**:
| Storage Method | Size |
|---------------|------|
| Uncompressed (1 byte/voxel) | 4MB |
| Palette-compressed (4-bit avg) | 2MB |
| Roblox row-packed format | 512KB |
| Disk storage (RLE + LZ4) | <100KB |

---

## Cave generation must respect water table boundaries

Three noise-based cave algorithms work well for Valheim aesthetics:

**Cheese caves** (large caverns): Sample 3D noise where values above threshold become air. Creates large pocket areas with organic "noise pillars." Formula: `is_cave = noise3D(x*0.01, y*0.01, z*0.01) > 0.6`

**Spaghetti caves** (winding tunnels): Air generates at the **edge of noise gradients** -- neither high nor low values. Creates long, narrow passages. Formula: `is_cave = abs(noise3D(x*0.02, y*0.02, z*0.02)) < 0.04`

**Perlin worms** (connecting tunnels): Walk through 3D noise space, carving spheres at each step. Direction sampled from three independent noise generators for X, Y, Z. Produces deterministic, naturally winding tunnels.

**Water table integration** requires a two-phase approach:

```rust
fn generate_caves_with_water(terrain: &mut TerrainData) {
    // Phase 1: Generate all caves ignoring water
    let caves = generate_noise_caves(terrain);
    
    // Phase 2: Classify and flood appropriately
    for region in caves.connected_regions() {
        let lowest_y = region.min_y();
        
        if lowest_y < WATER_LEVEL {
            if region.has_surface_opening_below_water() {
                // Cave connects to ocean - flood it
                flood_region(region, WATER_LEVEL);
            } else {
                // Sealed underground - optionally create aquifer
                if random() < UNDERGROUND_LAKE_CHANCE {
                    flood_region(region, lowest_y + random_depth());
                }
            }
        }
        // Caves entirely above water table remain dry
    }
}
```

**Simplest approach for preventing flooded cave issues**: Only generate caves above `WATER_LEVEL + 8`. This margin ensures cave floors don't accidentally dip below sea level, avoiding complex water boundary handling.

---

## Static water implementation maximizes performance

Following Valheim's lead, implement water as a **fixed global Y level** without flow simulation:

```rust
const WATER_LEVEL: i32 = 32;

fn is_underwater(x: i32, y: i32, z: i32, terrain: &TerrainData) -> bool {
    y < WATER_LEVEL && !terrain.is_solid(x, y, z)
}

fn generate_water_surface(chunk: &ChunkData) -> Option<Mesh> {
    // Only generate water quads where water meets air
    let mut quads = Vec::new();
    for x in 0..CHUNK_SIZE {
        for z in 0..CHUNK_SIZE {
            if chunk.get(x, WATER_LEVEL, z) == VoxelType::Water
                && chunk.get(x, WATER_LEVEL + 1, z) == VoxelType::Air 
            {
                quads.push(water_quad(x, WATER_LEVEL, z));
            }
        }
    }
    (!quads.is_empty()).then(|| build_mesh(quads))
}
```

Render water surface as a separate mesh pass with transparency and refraction shaders. Use depth testing to render **after opaque terrain** for proper water-terrain boundaries without visual artifacts.

---

## Bedrock prevents world escape with minimal complexity

**Probabilistic bedrock** (Minecraft-style) creates a natural-looking unbreakable floor:

```rust
fn generate_bedrock(x: i32, y: i32, z: i32, rng: &mut impl Rng) -> bool {
    match y {
        0 => true,  // Y=0: Always bedrock
        1..=4 => {
            // Y=1-4: Decreasing probability
            let probability = 1.0 - (y as f32 / 5.0);
            rng.gen::<f32>() < probability
        }
        _ => false  // Y>=5: Never bedrock
    }
}
```

Mark bedrock with a special `VoxelType` that your modification system refuses to alter. The visual distinction comes from material/texture -- darker, denser appearance than regular stone. Surface Nets handles bedrock identically to other materials; only the game logic treats it specially.

**Preventing void fall-through** requires three safeguards:
1. Bedrock layer itself (never destroyed)
2. Void damage below Y=0 (kill plane)
3. Placeholder collision during chunk loading (see Edge Cases section)

---

## Bevy implementation leverages Avian physics and ECS patterns

**Physics library choice**: For Bevy 0.15+ (note: 0.17 isn't released yet), both **bevy_rapier3d** and **Avian** (formerly bevy_xpbd) work well. Avian offers native ECS integration without world synchronization overhead -- it can be **4-6x faster** for collision-heavy scenes. Rapier is more mature with better documentation and now supports native voxel colliders.

**Collision layers setup**:

```rust
use bevy_rapier3d::prelude::*;

const TERRAIN_GROUP: Group = Group::GROUP_1;
const ENTITY_GROUP: Group = Group::GROUP_2;  
const WATER_GROUP: Group = Group::GROUP_3;   // Sensor, no physics response

// Terrain chunk
commands.spawn((
    Collider::trimesh(vertices, indices)?,
    CollisionGroups::new(TERRAIN_GROUP, ENTITY_GROUP | WATER_GROUP),
    RigidBody::Fixed,
));

// Player
commands.spawn((
    Collider::capsule_y(0.5, 0.3),
    CollisionGroups::new(ENTITY_GROUP, TERRAIN_GROUP | ENTITY_GROUP),
    RigidBody::Dynamic,
));
```

**Async mesh generation pattern**:

```rust
use bevy::tasks::{AsyncComputeTaskPool, Task};

#[derive(Component)]
struct ChunkMeshTask(Task<(Mesh, Option<Collider>)>);

fn spawn_mesh_tasks(
    mut commands: Commands,
    chunks: Query<(Entity, &ChunkPosition), With<NeedsMesh>>,
    terrain: Res<TerrainData>,
) {
    let pool = AsyncComputeTaskPool::get();
    
    for (entity, pos) in chunks.iter() {
        let data = terrain.get_chunk_data(pos.0).clone(); // Must own data
        
        let task = pool.spawn(async move {
            let mesh = surface_nets_mesh(&data);
            let collider = Collider::trimesh(
                mesh.positions.clone(), 
                mesh.indices.clone()
            ).ok();
            (mesh, collider)
        });
        
        commands.entity(entity)
            .insert(ChunkMeshTask(task))
            .remove::<NeedsMesh>();
    }
}
```

**Recommended crate stack**:
- **bevy_voxel_world 0.13+**: Production-ready voxel framework with LOD, multithreaded meshing
- **block-mesh**: Greedy meshing (used by bevy_voxel_world)
- **fast-surface-nets**: ~20 million triangles/second for smooth terrain
- **Avian or bevy_rapier3d**: Physics with trimesh support

---

## Performance optimization prioritized by impact

**Highest impact optimizations** (implement first):

1. **Frustum culling**: Immediate 50-90% reduction in rendered chunks. Test chunk AABBs against 6 frustum planes.

2. **Skip meshing fully enclosed chunks**: A chunk surrounded by 6 neighbors where all boundary voxels are solid needs no mesh -- only voxel data storage. Can eliminate **50-80% of underground meshes**.

3. **Binary greedy meshing**: Achieves **50-200 microseconds per chunk** versus ~1ms for naive approaches. The `binary-greedy-meshing` algorithm packs vertices to 8 bytes per quad.

4. **Row-packed memory format**: Roblox's approach stores unallocated rows as 1-byte defaults. Reduces typical terrain from 64KB to **2KB per chunk** (32x reduction).

**Preventing fall-through during chunk loading**:

```rust
// Solution: Placeholder AABB collision until mesh ready
fn ensure_chunk_collision(
    mut commands: Commands,
    chunks: Query<(Entity, &ChunkPosition), (With<Chunk>, Without<Collider>)>,
) {
    for (entity, pos) in chunks.iter() {
        // Temporary box collision matching chunk bounds
        commands.entity(entity).insert((
            Collider::cuboid(
                CHUNK_SIZE as f32 / 2.0,
                CHUNK_SIZE as f32 / 2.0, 
                CHUNK_SIZE as f32 / 2.0
            ),
            PlaceholderCollision, // Marker to replace later
        ));
    }
}
```

**Collision mesh update strategy**: Use **50-100ms debounce** on collision updates after terrain edits. Batch rapid modifications, process dirty chunks each physics tick. With 8^3 physics chunks (smaller than render chunks), full regeneration is fast enough -- incremental updates aren't worth the complexity.

---

## Edge cases require defensive design

**Thread-safe terrain modification** follows a staged pattern:

```rust
// Stage 1: Mark rows for modification (parallelizable)
terrain.mark_modifications(&pending_edits);

// Stage 2: Reallocate if needed (single-threaded)
terrain.reallocate_affected_chunks();

// Stage 3: Apply writes (parallel within chunks)
terrain.apply_modifications(&pending_edits);

// Stage 4: Flag chunks dirty (triggers remesh)
terrain.mark_dirty(&affected_chunks);
```

**Save/load serialization**: Use **RLE along the Y axis** (vertical runs compress best due to geological layering). Roblox achieves **0.05 bytes per voxel** with RLE + LZ4 compression -- 1000x reduction from raw storage. Store only modified chunks as deltas from procedural generation.

**Multiplayer terrain sync** has two viable approaches:
- **Edit replication**: Send RPCs like "remove sphere at X,Y,Z" -- low bandwidth but requires deterministic generation
- **Voxel-level replication**: Delta-compressed voxel data over TCP -- higher bandwidth but handles non-deterministic edits

---

## Recommended architecture summary

For your Bevy 0.15+ Valheim-aesthetic game with 64-depth terrain:

| Component | Recommendation |
|-----------|---------------|
| **Chunk structure** | 16x16x16 sections, 4 stacked vertically, palette compression |
| **Surface meshing** | fast-surface-nets crate with 18^3 boundary padding |
| **Collision (broadphase)** | Voxel bitmask, 1 bit per voxel |
| **Collision (narrowphase)** | Rapier trimesh, lazy-loaded per active chunk |
| **Physics library** | Avian (performance) or bevy_rapier3d (maturity) |
| **Cave generation** | Cheese + spaghetti noise, minimum Y = WATER_LEVEL + 8 |
| **Water** | Static global plane, separate transparent mesh pass |
| **Bedrock** | Probabilistic 5-layer at Y=0-4, refuse modification |
| **Memory format** | Row-packed in RAM, RLE + LZ4 on disk |
| **Async meshing** | AsyncComputeTaskPool with placeholder AABB collision |

**Performance targets**:
- Mesh generation: 50-200 microseconds per chunk (binary greedy) or ~1ms (Surface Nets)
- Memory: 0.5 bytes/voxel in RAM, 0.05 bytes/voxel on disk
- Collision update: 50-100ms debounce after edits
- Underground meshes: 50-80% eliminated via enclosed chunk detection

This architecture balances the smooth Valheim aesthetic (via Surface Nets) with the deep terrain capability of Minecraft (via vertical chunk stacking), while maintaining performance through hybrid collision and aggressive culling.
