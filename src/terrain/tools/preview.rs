use bevy::prelude::*;
use super::types::{TerrainTool, TerrainToolState};
use crate::camera::controller::PlayerCamera;
use crate::constants::INTERACTION_RANGE;
use crate::interaction::raycast_blocks;
use crate::voxel::world::VoxelWorld;

#[derive(Component)]
pub struct TerrainToolPreview {
    /// Normalized radius of this ring (0.0 to 1.0)
    pub radius_factor: f32,
}

/// Resource holding the current terrain raycast hit point
#[derive(Resource, Default)]
pub struct TerrainRaycastHit {
    pub position: Vec3,
    pub normal: Vec3,
}

pub fn spawn_preview(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // Create multiple concentric rings for better visibility
    let ring_configs = [
        (0.95, 1.0, 0.8),   // Outer ring - brightest
        (0.65, 0.70, 0.5),  // Middle ring
        (0.35, 0.40, 0.3),  // Inner ring - subtle
    ];

    for (inner, outer, alpha) in ring_configs {
        let material = materials.add(StandardMaterial {
            base_color: Color::srgba(1.0, 1.0, 0.9, alpha),
            unlit: true,
            alpha_mode: AlphaMode::Blend,
            cull_mode: None, // Visible from both sides
            ..default()
        });

        commands.spawn((
            Mesh3d(meshes.add(Annulus::new(inner, outer))),
            MeshMaterial3d(material),
            Transform::default(),
            Visibility::Hidden,
            TerrainToolPreview { radius_factor: outer },
        ));
    }
}

/// Update terrain raycast hit from camera
pub fn update_terrain_raycast(
    camera_query: Query<&Transform, With<PlayerCamera>>,
    world: Res<VoxelWorld>,
    state: Res<TerrainToolState>,
    mut commands: Commands,
    hit: Option<ResMut<TerrainRaycastHit>>,
) {
    // Only raycast when a terrain tool is active
    if state.active_tool == TerrainTool::None {
        if hit.is_some() {
            commands.remove_resource::<TerrainRaycastHit>();
        }
        return;
    }

    let Ok(transform) = camera_query.single() else {
        return;
    };

    let origin = transform.translation;
    let direction = transform.forward().as_vec3();

    if let Some((block_pos, normal)) = raycast_blocks(origin, direction, &world, INTERACTION_RANGE) {
        // Convert block position to world position (center of the hit face)
        let world_pos = block_pos.as_vec3() + Vec3::splat(0.5) + normal.as_vec3() * 0.5;
        let world_normal = normal.as_vec3().normalize();

        if let Some(mut existing_hit) = hit {
            existing_hit.position = world_pos;
            existing_hit.normal = world_normal;
        } else {
            commands.insert_resource(TerrainRaycastHit {
                position: world_pos,
                normal: world_normal,
            });
        }
    } else if hit.is_some() {
        commands.remove_resource::<TerrainRaycastHit>();
    }
}

pub fn update_preview(
    state: Res<TerrainToolState>,
    raycast_hit: Option<Res<TerrainRaycastHit>>,
    mut query: Query<(&TerrainToolPreview, &mut Transform, &mut Visibility)>,
) {
    for (preview, mut transform, mut visibility) in query.iter_mut() {
        if state.active_tool == TerrainTool::None {
            *visibility = Visibility::Hidden;
            continue;
        }

        let Some(ref hit) = raycast_hit else {
            *visibility = Visibility::Hidden;
            continue;
        };

        *visibility = Visibility::Visible;
        transform.translation = hit.position + Vec3::Y * 0.1;
        transform.scale = Vec3::splat(state.radius * 2.0 * preview.radius_factor);
        transform.rotation = Quat::from_rotation_arc(Vec3::Z, hit.normal);
    }
}
