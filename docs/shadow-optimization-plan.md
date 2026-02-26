# Shadow Optimization: Local-Only Rendering + Shadow Budget

## Goal

Reduce shadow pass GPU cost by:
1. Sphere-culling terrain shadow casters (only nearby chunks cast shadows)
2. Adding `NotShadowCaster` to water meshes (transparent, shouldn't cast opaque shadows)
3. Tightening directional light cascade distance from 1024m to 256m
4. Implementing a point light shadow budget (max N lights with shadows simultaneously)
5. Adding shadow stats to the F3 debug overlay

## Current State

- **DirectionalLight** (Sun): 4 cascades, 0.5–1024m range, 4096x4096 shadow maps
  - File: `src/environment.rs:117-125`
- **All terrain `ChunkMesh` entities** cast shadows regardless of distance — no `NotShadowCaster` management
- **Water mesh entities** also cast shadows (wasteful — they're translucent)
- **Props** already have distance-based shadow culling in `src/props/lod_material.rs:170-247` using `NotShadowCaster` — this is the pattern to follow
- **One PointLight** exists in gameplay (torch viewmodel, `src/viewmodel/mod.rs:313`, range=60, shadows=true)
- **Preview PointLights** (at Vec3(5000,5000,5000)) have no shadows — not relevant

### Key Bevy 0.18 APIs
- `bevy::light::NotShadowCaster` — component that removes an entity from all shadow passes
- `bevy::light::CascadeShadowConfigBuilder` — configures directional light cascades
- `bevy::light::DirectionalLightShadowMap { size: usize }` — global shadow map resolution
- No built-in shadow map caching — all shadow maps render every frame

---

## Step 1: Add Constants

**File:** `src/constants.rs`

After the existing "Prop Shadow and Material LOD Settings" section (after line 438), add:

```rust
// =============================================================================
// Terrain Shadow Culling Settings
// =============================================================================

/// Distance beyond which terrain chunks stop casting shadows.
/// Chunks beyond this distance get `NotShadowCaster` component added.
/// Set to match the cascade shadow max distance with margin.
pub const TERRAIN_SHADOW_DISTANCE: f32 = 192.0;

/// Hysteresis for terrain shadow culling to prevent flickering.
pub const TERRAIN_SHADOW_HYSTERESIS: f32 = 16.0;

/// Update interval for terrain shadow culling checks (seconds).
pub const TERRAIN_SHADOW_UPDATE_INTERVAL: f32 = 0.2;

/// Maximum number of point lights with shadows enabled simultaneously.
pub const MAX_SHADOW_POINT_LIGHTS: usize = 4;

/// Distance beyond which point light shadows are force-disabled.
pub const POINT_LIGHT_SHADOW_DISTANCE: f32 = 80.0;

/// Hysteresis for point light shadow budget switching.
pub const POINT_LIGHT_SHADOW_HYSTERESIS: f32 = 5.0;
```

---

## Step 2: Create Shadow Budget Module

**New file:** `src/rendering/shadow_budget.rs`

```rust
//! Shadow budget system — controls shadow rendering cost.
//!
//! Two subsystems:
//! 1. Terrain shadow culling: Adds `NotShadowCaster` to distant terrain chunks
//! 2. Point light shadow budget: Limits concurrent shadow-casting point lights

use bevy::light::NotShadowCaster;
use bevy::prelude::*;

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    CHUNK_SIZE_F32, MAX_SHADOW_POINT_LIGHTS, POINT_LIGHT_SHADOW_DISTANCE,
    POINT_LIGHT_SHADOW_HYSTERESIS, TERRAIN_SHADOW_DISTANCE, TERRAIN_SHADOW_HYSTERESIS,
    TERRAIN_SHADOW_UPDATE_INTERVAL,
};
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::plugin::WaterMesh;  // WaterMesh is the marker component on water entities

/// Configuration for shadow culling behaviour.
#[derive(Resource)]
pub struct ShadowBudgetConfig {
    /// Distance beyond which terrain stops casting shadows.
    pub terrain_shadow_distance: f32,
    /// Hysteresis for terrain shadow toggling.
    pub terrain_shadow_hysteresis: f32,
    /// Update interval in seconds for terrain shadow checks.
    pub terrain_update_interval: f32,
    /// Max point lights with shadows enabled at once.
    pub max_shadow_point_lights: usize,
    /// Distance beyond which point light shadows are disabled.
    pub point_light_shadow_distance: f32,
    /// Hysteresis for point light shadow toggling.
    pub point_light_shadow_hysteresis: f32,
}

impl Default for ShadowBudgetConfig {
    fn default() -> Self {
        Self {
            terrain_shadow_distance: TERRAIN_SHADOW_DISTANCE,
            terrain_shadow_hysteresis: TERRAIN_SHADOW_HYSTERESIS,
            terrain_update_interval: TERRAIN_SHADOW_UPDATE_INTERVAL,
            max_shadow_point_lights: MAX_SHADOW_POINT_LIGHTS,
            point_light_shadow_distance: POINT_LIGHT_SHADOW_DISTANCE,
            point_light_shadow_hysteresis: POINT_LIGHT_SHADOW_HYSTERESIS,
        }
    }
}

/// Statistics for the debug overlay.
#[derive(Resource, Default)]
pub struct ShadowCullingStats {
    pub terrain_with_shadows: usize,
    pub terrain_without_shadows: usize,
    pub point_lights_with_shadows: usize,
    pub point_lights_total: usize,
}

/// System: adds/removes `NotShadowCaster` on terrain `ChunkMesh` entities based on distance.
///
/// Pattern follows `update_prop_shadow_lod` in `src/props/lod_material.rs`.
/// Throttled to run every `terrain_update_interval` seconds.
pub fn update_terrain_shadow_culling(
    time: Res<Time>,
    config: Res<ShadowBudgetConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut commands: Commands,
    chunk_query: Query<
        (Entity, &ChunkMesh, &GlobalTransform, Option<&NotShadowCaster>),
        Without<WaterMesh>,  // Water handled separately — always NotShadowCaster
    >,
    mut stats: ResMut<ShadowCullingStats>,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < config.terrain_update_interval {
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation();

    let mut with_shadows = 0usize;
    let mut without_shadows = 0usize;

    for (entity, chunk_mesh, transform, has_no_shadow) in chunk_query.iter() {
        // Chunk center = transform position + half chunk size
        let chunk_center = transform.translation() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let distance = camera_pos.distance(chunk_center);

        let currently_no_shadow = has_no_shadow.is_some();
        // Hysteresis: use different thresholds depending on current state
        let threshold = if currently_no_shadow {
            config.terrain_shadow_distance - config.terrain_shadow_hysteresis
        } else {
            config.terrain_shadow_distance + config.terrain_shadow_hysteresis
        };

        let should_disable = distance > threshold;

        if should_disable != currently_no_shadow {
            if should_disable {
                commands.entity(entity).insert(NotShadowCaster);
            } else {
                commands.entity(entity).remove::<NotShadowCaster>();
            }
        }

        if should_disable {
            without_shadows += 1;
        } else {
            with_shadows += 1;
        }
    }

    stats.terrain_with_shadows = with_shadows;
    stats.terrain_without_shadows = without_shadows;
}

/// System: limits how many point lights have `shadows_enabled = true` simultaneously.
///
/// Sorts all point lights by distance from camera, enables shadows on the closest N,
/// disables shadows on the rest (or those beyond `point_light_shadow_distance`).
pub fn manage_point_light_shadow_budget(
    time: Res<Time>,
    config: Res<ShadowBudgetConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut lights: Query<(Entity, &mut PointLight, &GlobalTransform)>,
    mut stats: ResMut<ShadowCullingStats>,
    mut last_update: Local<f32>,
) {
    // Throttle — point light budget only needs updating a few times per second.
    let now = time.elapsed_secs();
    if now - *last_update < 0.1 {
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation();

    // Collect light distances
    let mut light_distances: Vec<(Entity, f32)> = lights
        .iter()
        .map(|(entity, _, transform)| {
            let dist = camera_pos.distance(transform.translation());
            (entity, dist)
        })
        .collect();

    // Sort by distance (closest first)
    light_distances.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut shadows_enabled_count = 0usize;
    let total = light_distances.len();

    for (entity, distance) in &light_distances {
        let Ok((_, mut point_light, _)) = lights.get_mut(*entity) else {
            continue;
        };

        let within_distance = *distance <= config.point_light_shadow_distance;
        let within_budget = shadows_enabled_count < config.max_shadow_point_lights;
        let should_have_shadows = within_distance && within_budget;

        if point_light.shadows_enabled != should_have_shadows {
            point_light.shadows_enabled = should_have_shadows;
        }

        if should_have_shadows {
            shadows_enabled_count += 1;
        }
    }

    stats.point_lights_with_shadows = shadows_enabled_count;
    stats.point_lights_total = total;
}

pub struct ShadowBudgetPlugin;

impl Plugin for ShadowBudgetPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ShadowBudgetConfig>()
            .init_resource::<ShadowCullingStats>()
            .add_systems(
                Update,
                (update_terrain_shadow_culling, manage_point_light_shadow_budget),
            );
    }
}
```

### Important notes for the implementor:
- `WaterMesh` is defined in `src/voxel/plugin.rs` — it's a marker component. Make sure the import path is correct. Currently it's not `pub` exported from the voxel module root, so you may need to either:
  - Use `crate::voxel::meshing::WaterMesh` (check if it's in `meshing.rs` or `plugin.rs`)
  - Or make it `pub` in the module hierarchy
- `ChunkMesh` is defined in `src/voxel/meshing.rs:33-35` with field `chunk_position: IVec3`
- `PlayerCamera` is in `crate::camera::controller::PlayerCamera`
- The terrain chunk mesh entities have a `Transform` component (set from world_pos when spawned at `plugin.rs:924-928`), **but** they may not have `GlobalTransform` explicitly — Bevy adds it automatically. Query with `&GlobalTransform` should work since Bevy propagates it.

---

## Step 3: Add `NotShadowCaster` to Water Mesh Spawns

**File:** `src/voxel/plugin.rs`

### 3a. Add import

Near the top of the file (around line 31, after the other imports), add:

```rust
use bevy::light::NotShadowCaster;
```

### 3b. Modify water mesh entity spawn

Find the water mesh spawn code at approximately line 995-1010. Currently it looks like:

```rust
let mut entity_cmd = commands.spawn((
    Mesh3d(water_mesh_handle),
    Transform::from_xyz(
        world_pos.x as f32,
        world_pos.y as f32,
        world_pos.z as f32,
    ),
    crate::voxel::meshing::ChunkMesh {
        chunk_position: chunk_pos,
    },
    WaterMesh,
    WaterMeshDetail {
        triangle_count: water_triangle_count,
        max_depth: water_max_depth,
    },
));
```

Add `NotShadowCaster` to the spawn tuple:

```rust
let mut entity_cmd = commands.spawn((
    Mesh3d(water_mesh_handle),
    Transform::from_xyz(
        world_pos.x as f32,
        world_pos.y as f32,
        world_pos.z as f32,
    ),
    crate::voxel::meshing::ChunkMesh {
        chunk_position: chunk_pos,
    },
    WaterMesh,
    WaterMeshDetail {
        triangle_count: water_triangle_count,
        max_depth: water_max_depth,
    },
    NotShadowCaster,  // Water is translucent — never cast opaque shadows
));
```

---

## Step 4: Reduce Cascade Shadow Distance

**File:** `src/environment.rs`

Find `CascadeShadowConfigBuilder` at lines 117-124. Change from:

```rust
CascadeShadowConfigBuilder {
    num_cascades: 4,
    minimum_distance: 0.5,
    maximum_distance: 1024.0,
    first_cascade_far_bound: 24.0,
    overlap_proportion: 0.35,
    ..default()
}
.build(),
```

To:

```rust
CascadeShadowConfigBuilder {
    num_cascades: 4,
    minimum_distance: 0.5,
    maximum_distance: 256.0,     // Was 1024 — matches terrain shadow cull distance + margin
    first_cascade_far_bound: 16.0,
    overlap_proportion: 0.3,
    ..default()
}
.build(),
```

**Why:** With `TERRAIN_SHADOW_DISTANCE = 192.0`, no shadow casters exist beyond ~208m (192+16 hysteresis). Rendering cascade 3 out to 1024m was wasting shadow map texels on empty space. Reducing to 256m gives 4x better texel density at the same 4096x4096 resolution.

### Integrated GPU override

There's an existing system `adjust_lod_for_integrated_gpu` in `src/voxel/plugin.rs`. If you want to also override cascade config on integrated GPU, add a new system in `src/environment.rs` that runs once after startup:

```rust
fn adjust_shadows_for_integrated_gpu(
    capabilities: Res<GraphicsCapabilities>,
    mut sun_query: Query<&mut CascadeShadowConfig, With<Sun>>,
    mut ran: Local<bool>,
) {
    if *ran || !capabilities.integrated_gpu {
        return;
    }
    *ran = true;

    for mut cascade_config in sun_query.iter_mut() {
        // Reduce to 2 cascades, shorter distance on integrated GPU
        *cascade_config = CascadeShadowConfigBuilder {
            num_cascades: 2,
            minimum_distance: 0.5,
            maximum_distance: 96.0,
            first_cascade_far_bound: 12.0,
            overlap_proportion: 0.25,
            ..default()
        }
        .build();
    }
}
```

Register this in the `EnvironmentPlugin::build()` method (in `src/environment.rs`) as an `Update` system. It uses `Local<bool>` to run only once after `GraphicsCapabilities` is populated (the capability detection runs in `Update` and may not be available at `Startup`).

**Note:** `CascadeShadowConfig` is the component on the directional light entity. `CascadeShadowConfigBuilder` is the builder. Both are from `bevy::light`. The `Sun` marker component is defined in `src/environment.rs`.

---

## Step 5: Register Shadow Budget Plugin

### 5a. `src/rendering/mod.rs`

Add this line in the module declarations (around line 46, after `pub mod water_reflection_compositor;`):

```rust
pub mod shadow_budget;
```

### 5b. `src/rendering/plugin.rs`

Add the import near the top (around line 29, after the god_rays import):

```rust
use crate::rendering::shadow_budget::ShadowBudgetPlugin;
```

Add the plugin registration inside `RenderingPlugin::build()`, after the GodRayPlugin line (around line 64):

```rust
// Shadow budget: terrain shadow culling + point light shadow limits
.add_plugins(ShadowBudgetPlugin)
```

---

## Step 6: Add Shadow Stats to Debug Overlay

**File:** `src/interaction/debug.rs`

### 6a. Add import

Near the top imports, add:

```rust
use crate::rendering::shadow_budget::ShadowCullingStats;
```

### 6b. Add to `update_debug_overlay` function signature

The function `update_debug_overlay` at line 375 already has many parameters. Add `ShadowCullingStats` as a new resource parameter:

```rust
pub fn update_debug_overlay(
    mut debug: DebugOverlayParams,
    targeted: Res<TargetedBlock>,
    targeted_prop: Res<TargetedProp>,
    world: Res<VoxelWorld>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    drag_state: Res<DragState>,
    network: Res<NetworkSession>,
    chunk_stats: Res<RuntimeChunkStats>,
    gen_state: Res<ChunkGenerationState>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    all_entities: Query<Entity>,
    diagnostics: Res<DiagnosticsStore>,
    mut query: Query<&mut Text, With<DebugOverlay>>,
    entity_breakdown: EntityBreakdownQuery,
    prop_debug: PropDebugQuery,
    shadow_stats: Res<ShadowCullingStats>,  // NEW
) {
```

### 6c. Add shadow stats display

After the chunk stats line (around line 450, after `text_content.push_str(&format!("Chunks: ...`), add:

```rust
    // Shadow budget
    text_content.push_str(&format!(
        "Shadows: terrain {}/{} lights {}/{}\n",
        shadow_stats.terrain_with_shadows,
        shadow_stats.terrain_with_shadows + shadow_stats.terrain_without_shadows,
        shadow_stats.point_lights_with_shadows,
        shadow_stats.point_lights_total,
    ));
```

This will show e.g. `Shadows: terrain 48/312 lights 2/8` in the always-visible section of the debug overlay.

---

## Step 7: Ensure `WaterMesh` is accessible

Check if `WaterMesh` (the marker component) is properly exported. It's used in the shadow budget module's query filter (`Without<WaterMesh>`).

**Look in:** `src/voxel/plugin.rs` for `pub struct WaterMesh` or `pub use` of it.

If `WaterMesh` is defined in `src/voxel/plugin.rs` but the `voxel` module doesn't re-export it, you have two options:
1. Add `pub use plugin::WaterMesh;` to `src/voxel/mod.rs`
2. Or use the full path `crate::voxel::plugin::WaterMesh` in the shadow_budget import

The same applies to `ChunkMesh` — check it's accessible from `crate::voxel::meshing::ChunkMesh`.

---

## Verification

After implementing all steps:

1. **Build:** `cargo build` — must compile without errors
2. **Run the game** and check:
   - Shadows appear normally on terrain near the player (within ~192 units)
   - Distant terrain (>200 units) has no shadows — this is expected and hard to notice at distance
   - Water surfaces no longer cast dark opaque shadow silhouettes
   - Torch light still casts point light shadows when held
3. **F3 debug overlay** shows the new "Shadows:" line with terrain/light counts
4. **Performance:** Shadow pass draw calls should be dramatically reduced (visible in GPU profiler or Bevy's built-in trace)
5. **Existing tests:** `cargo test` — `tests/chunk_tests.rs` should still pass (mesh generation is unchanged)

---

## File Change Summary

| File | Action | What Changes |
|------|--------|-------------|
| `src/constants.rs` | EDIT | Add 6 new constants after line 438 |
| `src/rendering/shadow_budget.rs` | CREATE | New file: config, stats, two systems, plugin |
| `src/rendering/mod.rs` | EDIT | Add `pub mod shadow_budget;` |
| `src/rendering/plugin.rs` | EDIT | Import + `.add_plugins(ShadowBudgetPlugin)` |
| `src/voxel/plugin.rs` | EDIT | Add `use bevy::light::NotShadowCaster;` import + add `NotShadowCaster` to water mesh spawn tuple |
| `src/environment.rs` | EDIT | Change cascade config values (3 numbers) + optional integrated GPU override system |
| `src/interaction/debug.rs` | EDIT | Import stats + add parameter + add 5-line display block |
