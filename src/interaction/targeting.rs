//! Block and entity targeting systems.
//!
//! This module handles raycasting from the camera to determine which
//! block or entity the player is looking at.

use bevy::prelude::*;
use crate::constants::{INTERACTION_RANGE, RAY_STEP, ENTITY_TARGET_CONE, ENTITY_TARGET_RADIUS};
use crate::entity::Wolf;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;

/// Resource tracking the currently targeted block.
#[derive(Resource, Default)]
pub struct TargetedBlock {
    /// World position of the targeted block, if any.
    pub position: Option<IVec3>,
    /// Normal of the face being looked at (direction from block to viewer).
    pub normal: Option<IVec3>,
    /// Type of voxel at the targeted position.
    pub voxel_type: Option<VoxelType>,
}

/// Resource tracking the currently targeted entity.
#[derive(Resource, Default)]
pub struct TargetedEntity {
    /// Entity being targeted, if any.
    pub entity: Option<Entity>,
    /// Distance to the targeted entity.
    pub distance: f32,
}

/// Cast a ray and find the first solid block hit.
///
/// # Arguments
/// * `origin` - Ray starting position (typically camera position)
/// * `direction` - Ray direction (typically camera forward)
/// * `world` - The voxel world to query
/// * `max_distance` - Maximum distance to cast the ray
///
/// # Returns
/// `Some((block_pos, normal))` if a block was hit, where:
/// - `block_pos` is the position of the hit block
/// - `normal` is the direction from the block to the viewer (which face was hit)
pub fn raycast_blocks(
    origin: Vec3,
    direction: Vec3,
    world: &VoxelWorld,
    max_distance: f32,
) -> Option<(IVec3, IVec3)> {
    let mut pos = origin;
    let step = direction.normalize() * RAY_STEP;
    let mut prev_block = IVec3::new(
        pos.x.floor() as i32,
        pos.y.floor() as i32,
        pos.z.floor() as i32,
    );

    let steps = (max_distance / RAY_STEP) as i32;

    for _ in 0..steps {
        pos += step;
        let block_pos = IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        );

        if block_pos != prev_block {
            if let Some(voxel) = world.get_voxel(block_pos) {
                if voxel.is_solid() {
                    // Calculate which face we hit based on direction
                    let normal = prev_block - block_pos;
                    return Some((block_pos, normal));
                }
            }
            prev_block = block_pos;
        }
    }

    None
}

/// System to update the targeted block based on camera look direction.
pub fn update_targeted_block(
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    world: Res<VoxelWorld>,
    mut targeted: ResMut<TargetedBlock>,
) {
    if let Ok(transform) = camera_query.single() {
        let origin = transform.translation;
        let direction = transform.forward().as_vec3();

        if let Some((block_pos, normal)) =
            raycast_blocks(origin, direction, &world, INTERACTION_RANGE)
        {
            targeted.position = Some(block_pos);
            targeted.normal = Some(normal);
            targeted.voxel_type = world.get_voxel(block_pos);
        } else {
            targeted.position = None;
            targeted.normal = None;
            targeted.voxel_type = None;
        }
    }
}

/// System to update the targeted entity based on camera look direction.
pub fn update_targeted_entity(
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    entity_query: Query<(Entity, &Transform), With<Wolf>>,
    mut targeted: ResMut<TargetedEntity>,
) {
    targeted.entity = None;
    targeted.distance = f32::MAX;

    if let Ok(camera_transform) = camera_query.single() {
        let origin = camera_transform.translation;
        let direction = camera_transform.forward().as_vec3();

        // Check all entities for intersection
        for (entity, entity_transform) in entity_query.iter() {
            let to_entity = entity_transform.translation - origin;
            let distance = to_entity.length();

            // Skip if too far
            if distance > INTERACTION_RANGE {
                continue;
            }

            // Check if entity is in front of camera (within cone)
            let dot = to_entity.normalize().dot(direction);
            if dot < ENTITY_TARGET_CONE {
                continue;
            }

            // Simple sphere collision
            let closest_point = origin + direction * dot * distance;
            let dist_to_ray = (entity_transform.translation - closest_point).length();

            if dist_to_ray < ENTITY_TARGET_RADIUS && distance < targeted.distance {
                targeted.entity = Some(entity);
                targeted.distance = distance;
            }
        }
    }
}
