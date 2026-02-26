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
use crate::voxel::meshing::{ChunkMesh, WaterMesh};

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
        Without<WaterMesh>, // Water handled separately — always NotShadowCaster
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

    for (entity, _chunk_mesh, transform, has_no_shadow) in chunk_query.iter() {
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
