//! Shadow budget system — controls shadow rendering cost.
//!
//! Two subsystems:
//! 1. Terrain shadow culling: Adds `NotShadowCaster` to distant terrain chunks
//! 2. Point light shadow budget: Limits concurrent shadow-casting point lights
//!
//! Ownership model: The budget system is the sole authority on shadow state
//! for entities it manages. Marker components (`ShadowBudgetTerrainCulled`,
//! `ShadowBudgetLightCulled`) track which entities had their shadow state
//! modified by the budget. When the budget is disabled, only budget-owned
//! entities are restored — authored shadow state on other entities is preserved.

use bevy::camera::primitives::{CascadesFrusta, Frustum, Sphere};
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use std::collections::HashMap;

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    CHUNK_SIZE_F32, MAX_SHADOW_POINT_LIGHTS, POINT_LIGHT_SHADOW_DISTANCE,
    POINT_LIGHT_SHADOW_HYSTERESIS, TERRAIN_SHADOW_DISTANCE, TERRAIN_SHADOW_HYSTERESIS,
    TERRAIN_SHADOW_UPDATE_INTERVAL,
};
use crate::voxel::meshing::{ChunkMesh, WaterMesh};

/// YAML file structure for `assets/config/shadows.yaml`.
#[derive(serde::Deserialize)]
struct ShadowBudgetFile {
    shadow_budget: ShadowBudgetFileInner,
}

#[derive(serde::Deserialize)]
struct ShadowBudgetFileInner {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    terrain: TerrainShadowFile,
    #[serde(default)]
    point_lights: PointLightShadowFile,
}

#[derive(serde::Deserialize)]
struct TerrainShadowFile {
    #[serde(default = "default_terrain_shadow_distance")]
    shadow_distance: f32,
    #[serde(default = "default_terrain_hysteresis")]
    hysteresis: f32,
    #[serde(default = "default_terrain_update_interval")]
    update_interval: f32,
}

#[derive(serde::Deserialize)]
struct PointLightShadowFile {
    #[serde(default = "default_max_shadow_point_lights")]
    max_shadow: usize,
    #[serde(default = "default_point_light_shadow_distance")]
    shadow_distance: f32,
    #[serde(default = "default_point_light_hysteresis")]
    hysteresis: f32,
    #[serde(default = "default_point_light_update_interval")]
    update_interval: f32,
}

fn default_true() -> bool { true }
fn default_terrain_shadow_distance() -> f32 { TERRAIN_SHADOW_DISTANCE }
fn default_terrain_hysteresis() -> f32 { TERRAIN_SHADOW_HYSTERESIS }
fn default_terrain_update_interval() -> f32 { TERRAIN_SHADOW_UPDATE_INTERVAL }
fn default_max_shadow_point_lights() -> usize { MAX_SHADOW_POINT_LIGHTS }
fn default_point_light_shadow_distance() -> f32 { POINT_LIGHT_SHADOW_DISTANCE }
fn default_point_light_hysteresis() -> f32 { POINT_LIGHT_SHADOW_HYSTERESIS }
fn default_point_light_update_interval() -> f32 { 0.1 }

impl Default for TerrainShadowFile {
    fn default() -> Self {
        Self {
            shadow_distance: default_terrain_shadow_distance(),
            hysteresis: default_terrain_hysteresis(),
            update_interval: default_terrain_update_interval(),
        }
    }
}

impl Default for PointLightShadowFile {
    fn default() -> Self {
        Self {
            max_shadow: default_max_shadow_point_lights(),
            shadow_distance: default_point_light_shadow_distance(),
            hysteresis: default_point_light_hysteresis(),
            update_interval: default_point_light_update_interval(),
        }
    }
}

/// Configuration for shadow culling behaviour.
#[derive(Resource)]
pub struct ShadowBudgetConfig {
    /// Whether terrain and point light shadow budgeting is active.
    pub enabled: bool,
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
    /// Update interval in seconds for point light shadow checks.
    pub point_light_update_interval: f32,
}

impl Default for ShadowBudgetConfig {
    fn default() -> Self {
        Self::load_from_yaml().unwrap_or_else(|| Self {
            enabled: true,
            terrain_shadow_distance: TERRAIN_SHADOW_DISTANCE,
            terrain_shadow_hysteresis: TERRAIN_SHADOW_HYSTERESIS,
            terrain_update_interval: TERRAIN_SHADOW_UPDATE_INTERVAL,
            max_shadow_point_lights: MAX_SHADOW_POINT_LIGHTS,
            point_light_shadow_distance: POINT_LIGHT_SHADOW_DISTANCE,
            point_light_shadow_hysteresis: POINT_LIGHT_SHADOW_HYSTERESIS,
            point_light_update_interval: 0.1,
        })
    }
}

impl ShadowBudgetConfig {
    fn load_from_yaml() -> Option<Self> {
        let config_str = std::fs::read_to_string("assets/config/shadows.yaml").ok()?;
        let file: ShadowBudgetFile = serde_yaml::from_str(&config_str).ok()?;
        let inner = file.shadow_budget;
        Some(Self {
            enabled: inner.enabled,
            terrain_shadow_distance: inner.terrain.shadow_distance,
            terrain_shadow_hysteresis: inner.terrain.hysteresis,
            terrain_update_interval: inner.terrain.update_interval,
            max_shadow_point_lights: inner.point_lights.max_shadow,
            point_light_shadow_distance: inner.point_lights.shadow_distance,
            point_light_shadow_hysteresis: inner.point_lights.hysteresis,
            point_light_update_interval: inner.point_lights.update_interval,
        })
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

/// Marker: terrain chunk had `NotShadowCaster` inserted by the shadow budget.
/// Only budget-owned entities have their shadow state restored when the budget
/// is disabled.
#[derive(Component)]
pub struct ShadowBudgetTerrainCulled;

/// Marker: point light had `shadows_enabled` set to `false` by the shadow budget.
#[derive(Component)]
pub struct ShadowBudgetLightCulled;

/// Stores the original `shadows_enabled` state of each point light before the
/// budget modified it. Used to restore authored state when the budget is disabled.
#[derive(Resource, Default)]
pub struct PointLightAuthoredState {
    pub states: HashMap<Entity, bool>,
}

/// System: adds/removes `NotShadowCaster` on terrain `ChunkMesh` entities based on
/// cascade frustum intersection and camera distance.
///
/// Uses `ShadowBudgetTerrainCulled` to track budget-owned entities. When the budget
/// is disabled, only budget-owned entities are restored to shadow-casting.
/// Throttled to run every `terrain_update_interval` seconds.
pub fn update_terrain_shadow_culling(
    time: Res<Time>,
    config: Res<ShadowBudgetConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut commands: Commands,
    chunk_query: Query<
        (
            Entity,
            &ChunkMesh,
            &GlobalTransform,
            Option<&NotShadowCaster>,
            Option<&ShadowBudgetTerrainCulled>,
        ),
        Without<WaterMesh>,
    >,
    directional_lights: Query<&CascadesFrusta, With<DirectionalLight>>,
    mut stats: ResMut<ShadowCullingStats>,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < config.terrain_update_interval {
        return;
    }
    *last_update = now;

    if !config.enabled {
        let mut with_shadows = 0usize;
        for (entity, _chunk_mesh, _transform, has_no_shadow, is_budget_culled) in
            chunk_query.iter()
        {
            if is_budget_culled.is_some() && has_no_shadow.is_some() {
                commands.entity(entity).remove::<NotShadowCaster>();
                commands.entity(entity).remove::<ShadowBudgetTerrainCulled>();
            }
            with_shadows += 1;
        }
        stats.terrain_with_shadows = with_shadows;
        stats.terrain_without_shadows = 0;
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation();

    // Collect all cascade frusta for the shadow test
    let cascade_frusta: Vec<&Frustum> = directional_lights
        .iter()
        .flat_map(|cascades_frusta| cascades_frusta.frusta.values().next())
        .flat_map(|frusta| frusta.iter())
        .collect();

    let mut with_shadows = 0usize;
    let mut without_shadows = 0usize;

    for (entity, _chunk_mesh, transform, has_no_shadow, _is_budget_culled) in chunk_query.iter() {
        let chunk_center = transform.translation() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let distance = camera_pos.distance(chunk_center);

        // Fast path: if well within shadow range, definitely cast
        let definitely_in_range =
            distance < config.terrain_shadow_distance - config.terrain_shadow_hysteresis;
        // Fast path: if well outside shadow range and no cascade contains us, definitely cull
        let definitely_outside_range =
            distance > config.terrain_shadow_distance + config.terrain_shadow_hysteresis;

        // Build a sphere for the chunk to test against cascade frusta
        let chunk_sphere = Sphere {
            center: Vec3A::from(chunk_center),
            radius: CHUNK_SIZE_F32 * 0.5 * 1.42, // sqrt(3) for diagonal coverage
        };
        let in_any_cascade = cascade_frusta
            .iter()
            .any(|f| f.intersects_sphere(&chunk_sphere, true));

        let currently_no_shadow = has_no_shadow.is_some();

        // Hysteresis: use different thresholds depending on current state
        let threshold = if currently_no_shadow {
            config.terrain_shadow_distance - config.terrain_shadow_hysteresis
        } else {
            config.terrain_shadow_distance + config.terrain_shadow_hysteresis
        };

        let should_disable = if definitely_in_range {
            false
        } else if definitely_outside_range && !in_any_cascade {
            true
        } else {
            // In the hysteresis band: use cascade intersection as tiebreaker
            if currently_no_shadow {
                distance > threshold || !in_any_cascade
            } else {
                distance > threshold && !in_any_cascade
            }
        };

        if should_disable != currently_no_shadow {
            if should_disable {
                commands
                    .entity(entity)
                    .insert((NotShadowCaster, ShadowBudgetTerrainCulled));
            } else {
                commands.entity(entity).remove::<NotShadowCaster>();
                commands
                    .entity(entity)
                    .remove::<ShadowBudgetTerrainCulled>();
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
/// Sorts all point lights by distance from camera, enables shadows on the closest N
/// within distance, disables shadows on the rest. Uses hysteresis to prevent flicker.
/// Preserves and restores authored shadow state via `PointLightAuthoredState`.
pub fn manage_point_light_shadow_budget(
    time: Res<Time>,
    config: Res<ShadowBudgetConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut lights: Query<(Entity, &mut PointLight, &GlobalTransform)>,
    mut authored_state: ResMut<PointLightAuthoredState>,
    mut stats: ResMut<ShadowCullingStats>,
    mut last_update: Local<f32>,
    mut was_enabled: Local<bool>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < config.point_light_update_interval {
        return;
    }
    *last_update = now;

    if !config.enabled {
        // Restore only lights the budget changed
        for (entity, mut point_light, _) in lights.iter_mut() {
            if let Some(&original) = authored_state.states.get(&entity) {
                point_light.shadows_enabled = original;
            }
        }
        authored_state.states.clear();

        let mut total = 0usize;
        let mut with_shadows = 0usize;
        for (_, point_light, _) in lights.iter() {
            total += 1;
            if point_light.shadows_enabled {
                with_shadows += 1;
            }
        }
        stats.point_lights_with_shadows = with_shadows;
        stats.point_lights_total = total;
        *was_enabled = false;
        return;
    }

    // On transition from disabled to enabled: snapshot all current authored states
    if !*was_enabled {
        for (entity, point_light, _) in lights.iter() {
            authored_state.states.insert(entity, point_light.shadows_enabled);
        }
        *was_enabled = true;
    }

    // Snapshot any newly spawned lights that we haven't seen yet
    for (entity, point_light, _) in lights.iter() {
        authored_state.states.entry(entity).or_insert(point_light.shadows_enabled);
    }

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

        // Hysteresis: lights that currently have shadows need to be further away to be disabled
        let distance_limit = if point_light.shadows_enabled {
            config.point_light_shadow_distance + config.point_light_shadow_hysteresis
        } else {
            config.point_light_shadow_distance - config.point_light_shadow_hysteresis
        };

        let within_distance = *distance <= distance_limit;
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
            .init_resource::<PointLightAuthoredState>()
            .add_systems(
                Update,
                (
                    update_terrain_shadow_culling,
                    manage_point_light_shadow_budget,
                ),
            );
    }
}
