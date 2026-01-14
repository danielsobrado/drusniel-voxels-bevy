use bevy::prelude::*;
use super::types::{TerrainTool, TerrainToolState};
use crate::camera::controller::PlayerCamera;
use crate::constants::INTERACTION_RANGE;
use crate::interaction::raycast_blocks;
use crate::voxel::world::VoxelWorld;

#[derive(Component)]
pub struct TerrainToolPreview;

/// Resource holding the current terrain raycast hit point
#[derive(Resource, Default)]
pub struct TerrainRaycastHit {
    pub position: Vec3,
    pub normal: Vec3,
}

pub fn spawn_preview(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>) {
    commands.spawn((
        Mesh3d(meshes.add(Circle::new(1.0))),
        MeshMaterial3d::<StandardMaterial>::default(),
        Transform::default(),
        Visibility::Hidden,
        TerrainToolPreview,
    ));
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
    mut query: Query<(&mut Transform, &mut Visibility), With<TerrainToolPreview>>,
) {
    let Ok((mut transform, mut visibility)) = query.single_mut() else {
        return;
    };

    if state.active_tool == TerrainTool::None {
        *visibility = Visibility::Hidden;
        return;
    }

    let Some(hit) = raycast_hit else {
        *visibility = Visibility::Hidden;
        return;
    };

    *visibility = Visibility::Visible;
    transform.translation = hit.position + Vec3::Y * 0.1;
    transform.scale = Vec3::splat(state.radius * 2.0);
    transform.rotation = Quat::from_rotation_arc(Vec3::Z, hit.normal);
}
