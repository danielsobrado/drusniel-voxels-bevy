# Building System Implementation Guide for Voxel Games

Document status (2026-05-17): reference guide; validate external/tool details before use.

Enshrouded takes a creative-freedom approach with no structural integrity, while Valheim and 7 Days to Die implement distinct stability systems--Valheim uses support value propagation through material hierarchies, and 7DTD calculates mass-based load limits. For a Rust/Bevy implementation, a hybrid grid-graph architecture with spatial hashing for snap points offers the best balance of performance and flexibility.

## Enshrouded's grid-based building prioritizes creative freedom

Enshrouded operates on a 1-meter voxel grid with building pieces in standardized sizes: 2M shapes (foundations, walls, doorframes, ceilings, stairs) and 4M shapes (wide variants). The game uses its proprietary Holistic Engine optimized specifically for voxel manipulation.

Snap mechanics work through predefined snap points on each prefab. Pressing X toggles snap-to-grid, while pieces lock to 90-degree rotation increments only. The system automatically detects adjacent pieces and aligns snap points, displaying a ghost preview before placement. Notably, overlapping blocks merge seamlessly--resource costs decrease when blocks share space since you only pay for actual voxel volume occupied.

The most significant design decision: Enshrouded has no structural integrity system. Buildings can float entirely unsupported. Removing foundations causes nothing to collapse. This was intentional--the developers chose "fantastical physics" to maximize creative freedom. Building pieces have durability (destructible by pickaxe) but no load-bearing calculations.

Terrain integration requires placing a Flame Altar first, which defines a 40x40x40 meter build zone expandable to 160 meters. Within this zone, terrain is fully modifiable--players can excavate underground, and modifications persist permanently. Outside altar radius, terrain resets after 5 in-game days.

## Valheim's stability system propagates support like fluid through materials

Valheim implements structural integrity through a numerical support value calculated in the `WearNTear` class. This isn't physics simulation--it's more like pressure propagating through pipes, flowing from grounded pieces upward through connections.

Each material defines four critical properties:

| Material | MaxSupport | MinSupport | VerticalLoss | HorizontalLoss |
|----------|------------|------------|--------------|----------------|
| Wood | 100 | 10 | 12.5% | 20% |
| Core Wood | 140 | 10 | 10% | 16.7% |
| Stone | 1000 | 100 | 12.5% | 100% |
| Wood Iron | 1500 | 20 | 7.7% | 7.7% |

Practical height limits: Wood reaches 16m vertical, Core Wood 24m, and Wood Iron approximately 50m. Stone's 100% horizontal loss means it cannot extend sideways without collapsing--it only supports vertically.

The color-coded feedback system makes invisible calculations visible: blue indicates grounded pieces (touching terrain/trees/rocks), progressing through green, yellow, orange, to red as stability decreases. When support drops to MinSupport, pieces collapse.

A key mechanic: material hierarchy resets stability. Wood placed on stone becomes blue (treated as grounded). Wood on iron also resets. This enables creative building techniques--stone pillars supporting wooden structures reset the stability chain entirely.

Support calculations run iteratively every 0.5 seconds, processing maximum 50 components per cycle. Large structures collapse sequentially rather than instantly, creating dramatic cascade effects when key supports are removed.

## 7 Days to Die uses mass-based load calculations

7DTD implements the most mathematically explicit system: Structural Integrity = floor(Max Load / Mass). This determines how many blocks of the same material can extend horizontally from a supported block.

The system operates on two axes independently:

Vertical support is infinite when connected to bedrock through an unbroken chain. Any block touching bedrock acts as ground (shows green in debug mode). Breaking any block in the chain converts everything above to horizontally-supported status.

Horizontal support is limited by Max Load per face. Each of the four side faces can support up to its Max Load value in attached mass. The engine enforces a hardcoded 15-block maximum horizontal span.

Material examples demonstrate the formula:
- Steel trussing (Max Load 320 / Mass 20) = SI 16, capped to 15 blocks
- Reinforced concrete (110 / 15) = 7 blocks horizontal
- Wood (40 / 5) = 8 blocks horizontal

7DTD uses a dual voxel system creating visual challenges: building blocks align to cardinal directions while terrain voxels rotate 45 degrees (diamond orientation). This causes visible gaps between placed blocks and natural terrain--a known limitation requiring workarounds like fence blocks or topsoil fills.

Collapse triggers instantly when support thresholds are exceeded. The game recalculates stability on-demand (block placement/destruction events), not continuously. Zombie AI exploits this--they target structural weak points to maximize collapse cascades.

## Snap point architecture determines building feel

Snap systems across all three games share core principles but differ in implementation sophistication.

Enshrouded uses the simplest approach: predefined snap points on prefabs with automatic nearest-neighbor matching. Building pieces contextually adapt appearance based on neighbors--walls, windows, and pillars reshape automatically where they connect.

Valheim stores snap points as Transform positions in Unity prefabs. Each piece contains an array of local-space coordinates. When holding a piece, the game raycasts to nearby pieces, attempts to match snap points, and selects the closest valid pair. Line pieces have endpoints plus midpoints; rectangular pieces have corners, edge midpoints, and center.

For Rust/Bevy implementation, the recommended pattern:

```rust
#[derive(Component)]
struct SnapPoint {
    local_offset: Vec3,      // Position relative to piece origin
    direction: Vec3,         // Normal direction for alignment
    compatible_types: Vec<PieceType>,  // What can connect here
}

fn find_best_snap(
    placement_ray: Ray,
    spatial_index: &SpatialIndex,
    new_piece: &SnapPoints,
) -> Option<(Entity, Transform)> {
    // Query nearby pieces using spatial hash
    // For each candidate, test snap point distances
    // Return closest valid match with computed transform
}
```

Spatial hashing is critical for performance--store snap points in a HashMap keyed by cell coordinates for O(1) average neighborhood queries. A cell size matching your grid size (1-4 meters typical) works well.

## Data structures for modular building systems

The optimal architecture combines sparse grid for placement lookups with graph structure for connectivity:

Grid component: `HashMap<IVec3, Entity>` provides O(1) lookup for "is there a piece at position X?" Essential for placement validation and neighbor queries during snapping.

Graph component: Adjacency lists track which pieces connect to others. This enables efficient structural integrity calculation via BFS/DFS traversal, building privilege propagation, and collapse cascade computation.

For Bevy ECS, structure components around building concerns:

```rust
#[derive(Component)]
struct BuildingPiece {
    piece_type: PieceType,
    material: Material,
    grid_position: IVec3,
    rotation: u8,  // 0-3 for 90-degree increments
}

#[derive(Component)]
struct StructuralSupport {
    stability: f32,
    is_grounded: bool,
    connected_to: Vec<Entity>,  // Graph edges
}

#[derive(Resource)]
struct BuildingGrid {
    cells: HashMap<IVec3, Entity>,
    chunks: HashMap<IVec3, ChunkData>,  // For spatial queries
}
```

Systems should chain: `handle_input -> validate_placement -> place_piece -> update_grid -> recalculate_stability -> propagate_collapse`.

## Surface Nets terrain requires SDF-based building integration

Surface Nets generates smooth terrain from signed distance fields, creating challenges for building placement that discrete voxel systems don't face. The terrain has no grid boundaries--it's continuous geometry.

Recommended integration approach:

1. Sample terrain SDF at building placement point to determine surface position and normal
2. Align foundation to terrain normal (or snap to vertical for grid-based building)
3. Carve building footprint into terrain using SDF subtraction operation
4. Regenerate affected chunk meshes (mark dirty, rebuild lazily)

```rust
fn carve_foundation(
    terrain: &mut SdfTerrain,
    building_bounds: Aabb,
    carve_depth: f32,
) {
    terrain.modify_region(building_bounds, |pos, current_sdf| {
        let box_sdf = box_distance(pos, building_bounds);
        current_sdf.max(-(box_sdf - carve_depth))  // CSG subtraction
    });
}
```

The `fast_surface_nets` Rust crate handles mesh generation at 20 million triangles/second--regenerating affected chunks after terrain modification is feasible in real-time.

For collision, use chunk-based lazy generation: only build collision meshes when physics contacts are created. Cache meshes with LRU eviction. Roblox's implementation uses ~24 bytes per triangle with kD-tree acceleration.

## Building piece categories follow consistent patterns

All three games organize pieces into similar functional categories:

| Category | Enshrouded | Valheim | 7 Days to Die |
|----------|------------|---------|---------------|
| Foundations | 2M, 4M variants | Wood floor, stone floor | Various block shapes |
| Walls | Narrow, standard, wide, stepped | 1m, 2m variants per material | 1200+ block shapes |
| Doorframes | 2M, 4M (two variants) | Per material type | Frame variants |
| Windows | 2M, 4M frames | Limited options | Multiple sizes |
| Roofs | Side, corners, peaks (2M/4M) | 26 degrees, 45 degrees variants | Wedge blocks |
| Stairs | 2M, 4M | Per material | Stair blocks |

Material variants are handled through composition in Enshrouded (44 block types with 100-block recipes), material enums in Valheim (wood, stone, iron prefab sets), and XML-defined material properties in 7DTD.

For Bevy, use component composition:

```rust
#[derive(Component)]
struct WallPiece;  // Marker

#[derive(Component)]
struct Material(MaterialType);  // Wood, Stone, etc.

// Query walls of specific material:
fn wooden_walls(query: Query<&Transform, (With<WallPiece>, With<Material>)>) { }
```

## Collision and physics integration varies by system

Enshrouded treats building pieces as static colliders with no physics simulation. Pieces have durability but destruction is binary--they either exist or don't. No collapse physics.

Valheim uses Unity's physics system for colliders but stability calculations are separate from physics. Collapse is animated/visual rather than physically simulated. Weather decay damages exposed wood to 50% HP but doesn't trigger physics.

7 Days to Die calculates structural integrity independently from physics, triggering immediate removal of unsupported blocks. The collapse is computed, not simulated--blocks simply disappear when SI thresholds fail.

For Bevy with bevy_rapier3d, the recommended approach:

- Use static rigid bodies for placed building pieces (no physics simulation)
- Calculate stability separately using graph traversal algorithms
- On collapse, either instantly remove pieces or spawn temporary dynamic bodies for dramatic physics-based falling (computationally expensive, use sparingly)
- Regenerate collision meshes only for affected chunks

## Implementation comparison for Rust/Bevy developers

| Aspect | Enshrouded Approach | Valheim Approach | 7DTD Approach | Recommended for Bevy |
|--------|---------------------|------------------|---------------|---------------------|
| Stability | None | Support propagation | Mass/Load formula | Support propagation (more intuitive) |
| Grid | 1m voxel | Snap point based | 1m blocks | Hybrid: 1-2m grid + snap points |
| Rotation | 90 degrees only | Free + snap | 90 degrees variants | 90 degrees for structure, free for props |
| Terrain | Full voxel carving | Heightmap + embed | Dual voxel | SDF carving for Surface Nets |
| Collapse | None | Cascade over time | Instant | Cascade (better feel) |

The Valheim model offers the best balance for most survival/building games--the color-coded feedback teaches players structural engineering intuitively, while the material hierarchy enables creative solutions. 7DTD's explicit formula works well for hardcore survival but requires more player knowledge. Enshrouded's no-stability approach suits creative/fantasy games prioritizing artistic freedom over engineering challenge.

## Conclusion

For a Rust/Bevy voxel game with Surface Nets terrain, implement a hybrid grid-graph architecture: sparse HashMap for O(1) position lookups, adjacency graph for connectivity queries, and spatial hashing for snap point detection. Use Valheim-style support propagation with material hierarchies rather than 7DTD's mass formulas--it creates more intuitive gameplay feedback. Integrate with Surface Nets through SDF carving operations for foundation placement, regenerating chunk meshes lazily. Static colliders work fine for building pieces; reserve physics simulation for optional dramatic collapse sequences. The `fast_surface_nets` and `bevy_rapier3d` crates provide solid foundations for the terrain and physics layers respectively.
