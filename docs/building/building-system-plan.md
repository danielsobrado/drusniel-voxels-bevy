# Construction System Project Plan

## Overview

A modular building system inspired by Enshrouded/Valheim for a Bevy 0.17 voxel game with Surface Nets terrain. Uses Avian physics, Valheim-style stability propagation, and precomputed physics-based collapse.

---

## Current Implementation Status (v0.4-dev)

### ✅ Completed Features

The following features from the plan have been implemented:

#### Phase 1: Core Data Structures
- **Task 1.1: Building Piece Registry** - ✅ Implemented
  - `BuildingPieceRegistry` resource with piece definitions
  - `PieceTypeId`, `PieceCategory`, `PieceDefinition` types
  - Predefined pieces: Floor 2x2, Wall, Fence, Pillar
  - Factory methods: `PieceDefinition::floor()`, `wall()`, `fence()`, `pillar()`

- **Task 1.3: Grid & Spatial Index** - ✅ Implemented
  - `BuildingGrid` with `HashMap<IVec3, Entity>` for O(1) lookups
  - `SnapPointIndex` spatial hash for snap point queries
  - `IndexedSnapPoint` for world-space snap point data
  - Efficient radius queries via cell-based iteration

#### Phase 2: Placement System
- **Task 2.1: Ghost Preview & Validation** - ✅ Implemented
  - Ghost entity with color-coded feedback (green/red/blue)
  - Gizmo-based visualization of piece bounds
  - Validation against terrain and existing pieces
  - Snap line visualization when snapped

- **Task 2.2: Snap Point Detection** - ✅ Implemented
  - `find_best_snap()` algorithm with scoring
  - Snap groups for compatibility: `FloorEdge`, `WallBottom`, `WallTop`, `WallSide`, `RoofEdge`, `Generic`
  - Alignment score (60%) + distance score (40%) weighting
  - 0.75m snap radius, 0.7 minimum alignment threshold

- **Task 2.4: Piece Spawning** - ✅ Implemented
  - `place_building_piece` system spawns entities
  - `BuildingPiece` component with type, grid position, rotation
  - Automatic snap point indexing on spawn
  - Grid registration for spatial queries

#### Phase 5: Building UI & Tools (Partial)
- **Task 5.2: Building Tools** - ✅ Partial
  - Palette UI integration with building pieces
  - Configurable keybindings (B, X, R) in Settings > Controls
  - `BuildingState` resource tracking active mode, selection, rotation
  - Rotation in 90° increments

### 📁 Implementation Files

```
src/building/
├── mod.rs          # Plugin definition, input handling
├── types.rs        # Core types: PieceTypeId, SnapGroup, PieceDefinition, BuildingState, SnapResult
├── grid.rs         # BuildingGrid, SnapPointIndex, IndexedSnapPoint
├── snap.rs         # Snap detection: find_best_snap(), calculate_snap_score()
└── ghost.rs        # Ghost preview: update_building_ghost(), validate_placement(), place_building_piece()
```

### 🎮 Controls

| Key | Action | Configurable |
|-----|--------|--------------|
| B | Open/Close Building Palette | Yes |
| X | Toggle Snap Mode | Yes |
| R | Rotate Piece 90° | Yes |
| Right Click | Place Piece | No |
| Arrow Up/Down | Navigate Palette | No |
| Enter | Select Palette Item | No |
| Escape | Close Palette | No |

### 📦 Predefined Building Pieces

| Piece | Dimensions | Snap Points | Can Ground |
|-------|------------|-------------|------------|
| Wood Floor 2x2 | 2m × 0.2m × 2m | 8 (4 edges + 4 corners) | Yes |
| Wood Wall | 2m × 2m × 0.2m | 4 (top, bottom, left, right) | No |
| Wood Fence | 2m × 1m × 0.1m | 3 (bottom + 2 ends) | Yes |
| Wood Pillar | 0.4m × 2m × 0.4m | 2 (top, bottom) | Yes |

### 🔗 Snap Group Compatibility

| Source | Compatible With |
|--------|-----------------|
| FloorEdge | FloorEdge, WallBottom, Generic |
| WallBottom | FloorEdge, Generic |
| WallTop | WallTop, RoofEdge, Generic |
| WallSide | WallSide, Generic |
| RoofEdge | WallTop, RoofEdge, Generic |
| Generic | Everything |

---

## Remaining Work

### Phase 1: Core Data Structures
- [ ] **Task 1.2: Material System** - Material variants (wood, stone, metal) with different properties

### Phase 2: Placement System
- [ ] **Task 2.3: Terrain Integration** - SDF carving for embedded foundations

### Phase 3: Stability System (Not Started)
- [ ] **Task 3.1: Support Graph** - Track piece connections for stability
- [ ] **Task 3.2: Stability Calculation** - Valheim-style propagation
- [ ] **Task 3.3: Visual Feedback** - Color-coded stability display

### Phase 4: Destruction & Collapse (Not Started)
- [ ] **Task 4.1: Piece Destruction** - Remove pieces with graph updates
- [ ] **Task 4.2: Collapse Detection** - Identify unstable pieces
- [ ] **Task 4.3: Physics-Based Collapse** - Convert to dynamic rigid bodies
- [ ] **Task 4.4: Collapse Optimization** - Performance limits

### Phase 5: Building UI & Tools
- [ ] **Task 5.1: Building Menu** - Full radial/category menu
- [ ] **Task 5.3: Build Zone System** - Define permitted areas

### Phase 6: Persistence & Multiplayer
- [ ] **Task 6.1: Save/Load** - Serialize building state
- [ ] **Task 6.2: Multiplayer Prep** - Network events

### Phase 7: Polish
- [ ] **Task 7.1: Audio & Effects** - Sound and particles
- [ ] **Task 7.2: Performance Profiling** - Optimize hot paths

---

## Phase 1: Core Data Structures & Configuration

### Task 1.1: Building Piece Registry ✅

**Status**: Implemented

**Objective**: Define all building piece types, their properties, and snap point configurations.

**Implementation**:
- `src/building/types.rs` - Core type definitions
- `PieceDefinition` with dimensions, snap points, mesh path, ground capability
- Factory methods for common pieces (floor, wall, fence, pillar)
- `BuildingPieceRegistry` resource initialized at startup

**Data Structures**:
```rust
pub struct PieceDefinition {
    pub id: PieceTypeId,
    pub name: String,
    pub category: PieceCategory,
    pub dimensions: Vec3,
    pub snap_points: Vec<SnapPointDef>,
    pub mesh_path: Option<String>,
    pub can_ground: bool,
}

pub struct SnapPointDef {
    pub local_offset: Vec3,
    pub direction: Vec3,
    pub snap_group: SnapGroup,
    pub compatible_pieces: Vec<PieceTypeId>,
}
```

---

### Task 1.2: Material System

**Status**: Not Started

**Objective**: Define building materials with stability properties matching Valheim's model.

**Technical Details**:
- Materials: Wood, HardWood, Stone, Metal, Thatch
- Each material defines: MaxSupport, MinSupport, VerticalLoss%, HorizontalLoss%
- Materials affect visual appearance (texture/mesh variants)
- Materials define crafting requirements

**Material Properties Table** (from Valheim analysis):
| Material | MaxSupport | MinSupport | VerticalLoss | HorizontalLoss |
|----------|------------|------------|--------------|----------------|
| Wood     | 100        | 10         | 12.5%        | 20%            |
| HardWood | 140        | 10         | 10%          | 16.7%          |
| Stone    | 1000       | 100        | 12.5%        | 100%           |
| Metal    | 1500       | 20         | 7.7%         | 7.7%           |
| Thatch   | 50         | 5          | 25%          | 40%            |

**Deliverables**:
- `src/building/materials.rs` - Material definitions
- `assets/config/materials.yaml` - Material configuration

---

### Task 1.3: Grid & Spatial Index ✅

**Status**: Implemented

**Objective**: Implement spatial data structures for O(1) piece lookups and snap detection.

**Implementation**:
- `src/building/grid.rs` - Grid and spatial index
- `BuildingGrid` with `HashMap<IVec3, Entity>` for occupied cells
- `SnapPointIndex` with smaller cell size for precision queries
- `query_radius()` for finding snap points within distance

**Data Structures**:
```rust
#[derive(Resource, Default)]
pub struct BuildingGrid {
    pub cells: HashMap<IVec3, Entity>,
    pub cell_size: f32,
}

#[derive(Resource, Default)]
pub struct SnapPointIndex {
    cells: HashMap<IVec3, Vec<IndexedSnapPoint>>,
    cell_size: f32,
}

pub struct IndexedSnapPoint {
    pub entity: Entity,
    pub piece_type: PieceTypeId,
    pub snap_index: usize,
    pub world_position: Vec3,
    pub world_direction: Vec3,
    pub snap_group: SnapGroup,
}
```

---

## Phase 2: Placement System

### Task 2.1: Ghost Preview & Validation ✅

**Status**: Implemented

**Objective**: Show placement preview with validity feedback before confirming placement.

**Implementation**:
- `src/building/ghost.rs` - Ghost preview entity management
- Color coding: Green (valid), Red (invalid), Blue (snapped)
- Gizmo-based cuboid visualization
- Snap line visualization when connected
- Validation against terrain voxels and existing grid cells

**Systems**:
1. `update_building_ghost` - Position ghost, check validity, render gizmos
2. `validate_placement` - Check terrain collisions and grid occupancy

---

### Task 2.2: Snap Point Detection ✅

**Status**: Implemented

**Objective**: Find and prioritize valid snap points for piece placement.

**Implementation**:
- `src/building/snap.rs` - Snap detection and scoring
- `find_best_snap()` queries spatial index within radius
- Filters by snap group compatibility
- Scores by alignment (60%) + distance (40%)
- Computes final transform from snap connection

**Algorithm**:
```
1. Get cursor world position from targeted block + normal
2. Query snap index for points within SNAP_RADIUS (0.75m)
3. For each candidate snap point on existing pieces:
   a. Check if new piece has compatible snap point (group matching)
   b. Calculate alignment score (direction dot product, inverted)
   c. Calculate distance score (inverse distance to cursor)
   d. Combined score = alignment * 0.6 + distance * 0.4
4. Sort by score, return best match
5. Compute transform: piece_origin = target_position - rotated_source_offset
```

**Configuration**:
```rust
pub struct SnapConfig {
    pub snap_radius: f32,        // 0.75m
    pub cell_size: f32,          // 2.0m
    pub alignment_weight: f32,   // 0.6
    pub distance_weight: f32,    // 0.4
    pub min_alignment: f32,      // 0.7 (~45°)
}
```

---

### Task 2.3: Terrain Integration

**Status**: Not Started

**Objective**: Handle building placement on Surface Nets terrain.

**Technical Details**:
- Foundations can embed partially into terrain
- Sample terrain SDF at placement corners to determine ground contact
- Optional terrain carving (SDF subtraction) for embedded foundations
- Ground contact grants "grounded" status for stability
- Terrain modification triggers chunk remesh

---

### Task 2.4: Piece Spawning ✅

**Status**: Implemented

**Objective**: Spawn building piece entities with all required components.

**Implementation**:
- `place_building_piece` system in `ghost.rs`
- Spawns Mesh3d + MeshMaterial3d + Transform + BuildingPiece
- Adds to BuildingGrid
- Triggers snap point index update via `Added<BuildingPiece>` query

**Entity Components**:
```rust
commands.spawn((
    Mesh3d(mesh),
    MeshMaterial3d(material),
    Transform::from_translation(position).with_rotation(rotation),
    BuildingPiece {
        piece_type,
        grid_position: grid_pos,
        rotation,
    },
));
```

---

## Phase 3: Stability System

### Task 3.1: Support Graph

**Status**: Not Started

**Objective**: Track piece connections as a directed graph for stability propagation.

**Technical Details**:
- Each piece maintains list of supporting pieces (incoming edges)
- Each piece maintains list of supported pieces (outgoing edges)
- Graph updates on piece placement/destruction
- Detect "grounded" status through graph traversal to terrain-touching pieces
- Support material hierarchy resets (wood on stone = new grounded root)

---

### Task 3.2: Stability Calculation

**Status**: Not Started

**Objective**: Implement Valheim-style stability value propagation.

**Technical Details**:
- Grounded pieces start at MaxSupport for their material
- Stability propagates through connections with directional loss
- Vertical connections: lose VerticalLoss% per step
- Horizontal connections: lose HorizontalLoss% per step
- Piece is stable if current_stability >= MinSupport
- Material hierarchy: placing on higher-tier material resets to grounded

---

### Task 3.3: Visual Feedback

**Status**: Not Started

**Objective**: Show stability status through color-coded visual feedback.

**Technical Details**:
- Color gradient: Blue (grounded) → Green → Yellow → Orange → Red (unstable)
- Toggle with key press (H for "health" or stability view)
- Overlay shader or vertex colors on building pieces
- Update colors when stability changes

---

## Phase 4: Destruction & Collapse

(See original plan for full details - not yet implemented)

---

## Phase 5: Building UI & Tools

### Task 5.1: Building Menu

**Status**: Not Started

**Objective**: UI for selecting building pieces and materials.

---

### Task 5.2: Building Tools ✅ (Partial)

**Status**: Partially Implemented

**Objective**: Implement hammer, repair, and demolish tools.

**Implementation**:
- Integrated with existing palette UI system
- BuildingPiece selection type in PlacementSelection enum
- Keybindings configurable via Settings > Controls tab
- `BuildingState` resource for mode tracking

**Tool State**:
```rust
#[derive(Resource)]
pub struct BuildingState {
    pub active: bool,
    pub selected_piece: Option<PieceTypeId>,
    pub rotation: u8,  // 0-3 for 90° increments
    pub snap_enabled: bool,
    pub current_snap: Option<SnapResult>,
}
```

**Remaining**:
- [ ] Repair tool
- [ ] Demolish tool with resource return
- [ ] Tool-specific cursors

---

### Task 5.3: Build Zone System

**Status**: Not Started

**Objective**: Define areas where building is permitted.

---

## Phase 6: Persistence & Multiplayer Prep

(See original plan for full details - not yet implemented)

---

## Phase 7: Polish & Optimization

(See original plan for full details - not yet implemented)

---

## Dependency Graph

```
Phase 1 (Foundation)
├── 1.1 Piece Registry ✅
├── 1.2 Material System
└── 1.3 Grid & Spatial Index ✅

Phase 2 (Placement) - depends on Phase 1
├── 2.1 Ghost Preview ✅ ─────┐
├── 2.2 Snap Detection ✅ ────┼── 2.4 Piece Spawning ✅
├── 2.3 Terrain Integration ──┘
└── 2.4 Piece Spawning ✅

Phase 3 (Stability) - depends on Phase 2
├── 3.1 Support Graph
├── 3.2 Stability Calculation ── depends on 3.1
└── 3.3 Visual Feedback ──────── depends on 3.2

Phase 4 (Destruction) - depends on Phase 3
├── 4.1 Piece Destruction
├── 4.2 Collapse Detection ───── depends on 4.1
├── 4.3 Physics Collapse ─────── depends on 4.2
└── 4.4 Collapse Optimization ── depends on 4.3

Phase 5 (UI) - can parallel with Phase 3+
├── 5.1 Building Menu
├── 5.2 Building Tools ✅ (Partial)
└── 5.3 Build Zone System

Phase 6 (Persistence) - depends on Phase 4
├── 6.1 Save/Load
└── 6.2 Multiplayer Prep

Phase 7 (Polish) - depends on Phase 6
├── 7.1 Audio & Effects
└── 7.2 Performance Profiling
```

---

## File Structure

```
src/building/
├── mod.rs              # Plugin, input handling ✅
├── types.rs            # Core types ✅
├── grid.rs             # Grid & spatial index ✅
├── snap.rs             # Snap detection ✅
├── ghost.rs            # Ghost preview & spawning ✅
│
├── materials.rs        # Material properties (TODO)
├── stability/          # Stability system (TODO)
│   ├── mod.rs
│   ├── graph.rs
│   ├── calculation.rs
│   └── visual.rs
├── collapse/           # Collapse system (TODO)
│   ├── mod.rs
│   ├── detection.rs
│   ├── physics.rs
│   └── budget.rs
├── tools/              # Building tools (TODO)
│   ├── mod.rs
│   ├── demolish.rs
│   └── repair.rs
├── zones.rs            # Build zones (TODO)
├── save.rs             # Persistence (TODO)
└── audio.rs            # Sound effects (TODO)
```

---

## Configuration Files

```
assets/config/building/     # (TODO)
├── pieces.yaml             # Piece definitions
├── materials.yaml          # Material properties
├── stability.yaml          # Stability thresholds
├── collapse.yaml           # Physics settings
├── zones.yaml              # Build zone defaults
└── audio.yaml              # Sound mappings
```

Currently using hardcoded configuration in `src/building/grid.rs`:
```rust
pub struct SnapConfig {
    pub snap_radius: f32,        // 0.75
    pub cell_size: f32,          // 2.0
    pub alignment_weight: f32,   // 0.6
    pub distance_weight: f32,    // 0.4
    pub min_alignment: f32,      // 0.7
}
```
