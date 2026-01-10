# Terrain Simplification - Mountains Without NPCs/Dungeons

## Overview

Simplified the game world to focus on mountainous terrain exploration by removing NPCs and dungeon structures.

## Changes Made

### 1. Removed NPCs (Rabbits & Wolves)

**File:** `src/entity/mod.rs`

Removed the spawning and animation systems for wolves and rabbits from the EntityPlugin:

```rust
impl Plugin for EntityPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Inventory>()
            .init_resource::<EntitySpawnState>()
            .init_resource::<EntitySpawnConfig>()
            // NPCs (wolves, rabbits) removed
            .add_systems(
                Update,
                (
                    handle_death,
                    process_item_drops,
                    despawn_dead.after(process_item_drops),
                ),
            );
    }
}
```

The entity modules (`rabbit.rs`, `wolf.rs`) still exist but are no longer active.

### 2. Removed Dungeons

**File:** `src/voxel/terrain.rs`

Disabled dungeon generation by commenting out the dungeon voxel check in `get_voxel()`:

```rust
pub fn get_voxel(&self, world_x: i32, world_y: i32, world_z: i32) -> VoxelType {
    let terrain_height = self.get_height(world_x, world_z);
    let biome = self.get_biome(world_x, world_z);

    // Dungeons disabled

    // Check caves
    // ...
}
```

Also removed dungeon-related constants from imports and deleted the dungeon placement test.

### 3. Enhanced Mountain Terrain

**File:** `src/constants.rs`

Adjusted terrain generation constants for more dramatic mountains:

| Constant | Before | After | Effect |
|----------|--------|-------|--------|
| `TERRAIN_MAX_HEIGHT` | 58.0 | 120.0 | Allows much taller terrain |
| `MOUNTAIN_THRESHOLD` | 0.65 | 0.35 | More areas become mountains |
| `MOUNTAIN_MULTIPLIER` | 50.0 | 150.0 | Mountains are taller |

These changes create a more mountainous landscape with peaks reaching up to 120 blocks instead of the previous 58 block limit.

### 4. Fixed A/D Movement Direction

**File:** `src/player/input.rs`

Fixed the `right` vector calculation which was inverted, causing A and D keys to move in opposite directions:

```rust
// Before (incorrect - produced LEFT direction)
let right = Vec3::new(forward.z, 0.0, -forward.x);

// After (correct - produces RIGHT direction)
let right = Vec3::new(-forward.z, 0.0, forward.x);
```

## Result

The world now features:
- Dramatic mountainous terrain with peaks up to 120 blocks
- No NPC entities (wolves, rabbits)
- No dungeon structures
- Caves, trees, water, and biomes remain intact
- Correct WASD movement controls
