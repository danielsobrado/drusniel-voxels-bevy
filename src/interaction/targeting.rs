//! Block and entity targeting systems.
//!
//! This module handles raycasting from the camera to determine which
//! block or entity the player is looking at.

use crate::constants::{ENTITY_TARGET_CONE, ENTITY_TARGET_RADIUS, INTERACTION_RANGE, RAY_STEP};
use crate::props::{Prop, PropType};
use crate::runtime_commands::EditorPropInstanceId;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::prelude::*;
use bevy::window::PrimaryWindow;

const EDITOR_SELECTION_RANGE: f32 = 512.0;

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

/// Resource tracking the block explicitly selected by an editor viewport click.
#[derive(Resource, Default)]
pub struct SelectedBlock {
    /// World position of the selected block, if any.
    pub position: Option<IVec3>,
    /// Normal of the selected face.
    pub normal: Option<IVec3>,
    /// Type of voxel at the selected position.
    pub voxel_type: Option<VoxelType>,
}

/// Resource tracking the prop explicitly selected by an editor viewport click.
#[derive(Resource, Default)]
pub struct SelectedProp {
    /// Frontend-facing prop id.
    pub id: Option<String>,
    /// Human-readable selection label.
    pub label: Option<String>,
    /// Runtime world position of the selected prop.
    pub position: Option<Vec3>,
}

impl SelectedProp {
    fn clear(&mut self) {
        self.id = None;
        self.label = None;
        self.position = None;
    }
}

impl SelectedBlock {
    fn clear(&mut self) {
        self.position = None;
        self.normal = None;
        self.voxel_type = None;
    }
}

/// Resource tracking the currently targeted entity.
#[derive(Resource, Default)]
pub struct TargetedEntity {
    /// Entity being targeted, if any.
    pub entity: Option<Entity>,
    /// Distance to the targeted entity.
    pub distance: f32,
}

/// Resource tracking the currently targeted prop.
#[derive(Resource, Default)]
pub struct TargetedProp {
    /// Prop entity being targeted, if any.
    pub entity: Option<Entity>,
    /// Distance to the targeted prop.
    pub distance: f32,
    /// World position of the targeted prop, if any.
    pub position: Option<Vec3>,
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
            if let VoxelSample::InBounds(voxel) = world.sample_voxel_for_interaction(block_pos) {
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
            targeted.voxel_type = world.sample_voxel_for_interaction(block_pos).voxel();
        } else {
            targeted.position = None;
            targeted.normal = None;
            targeted.voxel_type = None;
        }
    }
}

/// Selects a block from the actual cursor position in the native editor viewport.
pub fn select_block_from_cursor_in_editor_viewport(
    windows: Query<&Window, With<PrimaryWindow>>,
    camera_query: Query<(&Camera, &GlobalTransform), With<crate::camera::controller::PlayerCamera>>,
    mouse: Res<ButtonInput<MouseButton>>,
    world: Res<VoxelWorld>,
    targeted: Res<TargetedBlock>,
    mut selected: ResMut<SelectedBlock>,
    mut selected_prop: ResMut<SelectedProp>,
    prop_query: Query<(Entity, &Prop, &GlobalTransform, Option<&EditorPropInstanceId>)>,
) {
    if std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_none()
        || !mouse.just_pressed(MouseButton::Left)
    {
        return;
    }

    let Ok(window) = windows.single() else {
        return;
    };
    let Ok((camera, camera_transform)) = camera_query.single() else {
        return;
    };
    let Some(cursor_position) = window.cursor_position() else {
        if !select_from_editor_ray(
            camera_transform.translation(),
            camera_transform.forward().as_vec3(),
            &world,
            &prop_query,
            &mut selected,
            &mut selected_prop,
        ) {
            select_targeted_block(&targeted, &world, &mut selected, &mut selected_prop);
        }
        return;
    };
    let Ok(ray) = camera.viewport_to_world(camera_transform, cursor_position) else {
        if !select_from_editor_ray(
            camera_transform.translation(),
            camera_transform.forward().as_vec3(),
            &world,
            &prop_query,
            &mut selected,
            &mut selected_prop,
        ) {
            select_targeted_block(&targeted, &world, &mut selected, &mut selected_prop);
        }
        return;
    };

    if !select_from_editor_ray(
        ray.origin,
        ray.direction.as_vec3(),
        &world,
        &prop_query,
        &mut selected,
        &mut selected_prop,
    ) && !select_targeted_block(&targeted, &world, &mut selected, &mut selected_prop) {
        selected.clear();
        selected_prop.clear();
    }
}

fn select_from_editor_ray(
    origin: Vec3,
    direction: Vec3,
    world: &VoxelWorld,
    prop_query: &Query<(Entity, &Prop, &GlobalTransform, Option<&EditorPropInstanceId>)>,
    selected: &mut SelectedBlock,
    selected_prop: &mut SelectedProp,
) -> bool {
    let block_hit = raycast_blocks(origin, direction, world, EDITOR_SELECTION_RANGE).map(|hit| {
        let center = hit.0.as_vec3() + Vec3::splat(0.5);
        let distance = (center - origin).dot(direction).max(0.0);
        (hit, distance)
    });
    let prop_hit = nearest_prop_hit(origin, direction, EDITOR_SELECTION_RANGE, &prop_query);

    match (prop_hit, block_hit) {
        (Some(prop), Some((block, block_distance))) if prop.distance <= block_distance => {
            selected.clear();
            selected_prop.id = Some(prop.id);
            selected_prop.label = Some(prop.label);
            selected_prop.position = Some(prop.position);
            let _ = block;
            true
        }
        (Some(prop), None) => {
            selected.clear();
            selected_prop.id = Some(prop.id);
            selected_prop.label = Some(prop.label);
            selected_prop.position = Some(prop.position);
            true
        }
        (_, Some(((block_pos, normal), _))) => {
            selected_prop.clear();
            selected.position = Some(block_pos);
            selected.normal = Some(normal);
            selected.voxel_type = world.sample_voxel_for_interaction(block_pos).voxel();
            true
        }
        (None, None) => {
            false
        }
    }
}

struct PropHit {
    id: String,
    label: String,
    position: Vec3,
    distance: f32,
}

fn nearest_prop_hit(
    origin: Vec3,
    direction: Vec3,
    max_distance: f32,
    prop_query: &Query<(Entity, &Prop, &GlobalTransform, Option<&EditorPropInstanceId>)>,
) -> Option<PropHit> {
    let mut nearest: Option<PropHit> = None;
    for (entity, prop, transform, instance_id) in prop_query.iter() {
        let center = transform.translation();
        let radius = prop_selection_radius(prop.prop_type);
        let Some(distance) = ray_sphere_distance(origin, direction, center, radius) else {
            continue;
        };
        if distance > max_distance {
            continue;
        }
        if nearest.as_ref().is_some_and(|current| current.distance <= distance) {
            continue;
        }

        let id = instance_id
            .map(|id| id.0.clone())
            .unwrap_or_else(|| format!("runtime-prop-{}", entity.index()));
        let label = format!("{:?} {}", prop.prop_type, id);
        nearest = Some(PropHit {
            id,
            label,
            position: center,
            distance,
        });
    }

    nearest
}

fn prop_selection_radius(prop_type: PropType) -> f32 {
    match prop_type {
        PropType::Tree => 4.5,
        PropType::Rock => 2.5,
        PropType::Bush => 2.0,
        PropType::Flower => 1.25,
    }
}

fn ray_sphere_distance(origin: Vec3, direction: Vec3, center: Vec3, radius: f32) -> Option<f32> {
    let offset = origin - center;
    let half_b = offset.dot(direction);
    let c = offset.length_squared() - radius * radius;
    let discriminant = half_b * half_b - c;
    if discriminant < 0.0 {
        return None;
    }

    let root = discriminant.sqrt();
    let near = -half_b - root;
    if near >= 0.0 {
        return Some(near);
    }

    let far = -half_b + root;
    if far >= 0.0 {
        Some(far)
    } else {
        None
    }
}

fn select_targeted_block(
    targeted: &TargetedBlock,
    world: &VoxelWorld,
    selected: &mut SelectedBlock,
    selected_prop: &mut SelectedProp,
) -> bool {
    if let Some(block_pos) = targeted.position {
        selected_prop.clear();
        selected.position = Some(block_pos);
        selected.normal = targeted.normal;
        selected.voxel_type = world.sample_voxel_for_interaction(block_pos).voxel();
        true
    } else {
        false
    }
}

/// System to update the targeted entity based on camera look direction.
/// (Empty now as NPCs are removed)
pub fn update_targeted_entity(mut targeted: ResMut<TargetedEntity>) {
    targeted.entity = None;
    targeted.distance = f32::MAX;
}

/// System to update the targeted prop based on camera look direction.
pub fn update_targeted_prop(
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    prop_query: Query<(Entity, &GlobalTransform), With<Prop>>,
    mut targeted: ResMut<TargetedProp>,
) {
    targeted.entity = None;
    targeted.distance = f32::MAX;
    targeted.position = None;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let origin = camera_transform.translation;
    let direction = camera_transform.forward().as_vec3();

    for (entity, transform) in prop_query.iter() {
        let pos = transform.translation();
        let to_entity = pos - origin;
        let distance = to_entity.length();

        if distance < 0.001 || distance > INTERACTION_RANGE {
            continue;
        }

        let dot = to_entity.normalize().dot(direction);
        if dot < ENTITY_TARGET_CONE {
            continue;
        }

        let closest_point = origin + direction * dot * distance;
        let dist_to_ray = (pos - closest_point).length();

        if dist_to_ray < ENTITY_TARGET_RADIUS && distance < targeted.distance {
            targeted.entity = Some(entity);
            targeted.distance = distance;
            targeted.position = Some(pos);
        }
    }
}
