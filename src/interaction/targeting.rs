//! Block and entity targeting systems.
//!
//! This module handles raycasting from the camera to determine which
//! block or entity the player is looking at.

use crate::constants::{ENTITY_TARGET_CONE, ENTITY_TARGET_RADIUS, INTERACTION_RANGE, RAY_STEP};
use crate::editor_diagnostics::{
    EditorDiagnosticsCategory, EditorDiagnosticsState, editor_diagnostics_log,
};
use crate::props::{Prop, PropType};
use crate::runtime_commands::EditorPropInstanceId;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::prelude::*;
use bevy::window::PrimaryWindow;

const EDITOR_SELECTION_RANGE: f32 = 512.0;

/// Extended crosshair reach used while the Alt+K chunk-border overlay is on, so
/// distant terrain (e.g. LOD cracks) can be aimed at, highlighted, and probed
/// with Shift+F9. Falls back to `INTERACTION_RANGE` when the overlay is off.
const DEBUG_TARGET_RANGE: f32 = 512.0;

#[derive(Default)]
pub(crate) struct EditorHoverDebugState {
    last_entity: Option<Entity>,
    last_cursor_available: bool,
    last_ray_available: bool,
}

#[derive(Default)]
pub(crate) struct EditorHighlightDebugState {
    reported_initial: bool,
    last_editor_controlled: bool,
    last_hovered: Option<Entity>,
    last_selected: Option<Entity>,
}

fn editor_debug_log(
    diagnostics: Option<&EditorDiagnosticsState>,
    category: EditorDiagnosticsCategory,
    message: impl AsRef<str>,
) {
    editor_diagnostics_log(diagnostics, category, message);
}

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
    /// Runtime entity backing this selection.
    pub entity: Option<Entity>,
    /// Frontend-facing prop id.
    pub id: Option<String>,
    /// Human-readable selection label.
    pub label: Option<String>,
    /// Runtime world position of the selected prop.
    pub position: Option<Vec3>,
}

impl SelectedProp {
    fn clear(&mut self) {
        self.entity = None;
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
    /// Frontend-facing prop id.
    pub id: Option<String>,
    /// Human-readable hover label.
    pub label: Option<String>,
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
    debug_toggles: Res<crate::interaction::DebugDetailToggles>,
    mut targeted: ResMut<TargetedBlock>,
) {
    if let Ok(transform) = camera_query.single() {
        let origin = transform.translation;
        let direction = transform.forward().as_vec3();

        // Reach farther while the Alt+K chunk-border overlay is on so distant
        // LOD cracks can be targeted for the Shift+F9 terrain hole probe.
        let range = if debug_toggles.show_chunk_borders {
            DEBUG_TARGET_RANGE
        } else {
            INTERACTION_RANGE
        };

        if let Some((block_pos, normal)) = raycast_blocks(origin, direction, &world, range) {
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
    prop_query: Query<(
        Entity,
        &Prop,
        &GlobalTransform,
        Option<&EditorPropInstanceId>,
    )>,
    diagnostics: Option<Res<EditorDiagnosticsState>>,
) {
    if std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_none()
        || !mouse.just_pressed(MouseButton::Left)
    {
        return;
    }

    let diagnostics = diagnostics.as_deref();
    let Ok(window) = windows.single() else {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            "click ignored: no primary window",
        );
        return;
    };
    let Ok((camera, camera_transform)) = camera_query.single() else {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            "click ignored: no player camera",
        );
        return;
    };
    let Some(cursor_position) = window.cursor_position() else {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            format!(
                "[editor-selection] click cursor unavailable focused={} camera_pos=({:.2},{:.2},{:.2}); falling back to camera forward ray",
                window.focused,
                camera_transform.translation().x,
                camera_transform.translation().y,
                camera_transform.translation().z
            ),
        );
        if !select_from_editor_ray(
            camera_transform.translation(),
            camera_transform.forward().as_vec3(),
            &world,
            &prop_query,
            &mut selected,
            &mut selected_prop,
            diagnostics,
        ) {
            select_targeted_block(
                &targeted,
                &world,
                &mut selected,
                &mut selected_prop,
                diagnostics,
            );
        }
        return;
    };
    editor_debug_log(
        diagnostics,
        EditorDiagnosticsCategory::Selection,
        format!(
            "[editor-selection] click cursor=({:.1},{:.1}) window=({:.1}x{:.1}) focused={} camera_pos=({:.2},{:.2},{:.2})",
            cursor_position.x,
            cursor_position.y,
            window.width(),
            window.height(),
            window.focused,
            camera_transform.translation().x,
            camera_transform.translation().y,
            camera_transform.translation().z
        ),
    );
    let Ok(ray) = camera.viewport_to_world(camera_transform, cursor_position) else {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            format!(
                "[editor-selection] cursor ray unavailable; falling back to camera forward ray cursor=({:.1},{:.1})",
                cursor_position.x, cursor_position.y
            ),
        );
        if !select_from_editor_ray(
            camera_transform.translation(),
            camera_transform.forward().as_vec3(),
            &world,
            &prop_query,
            &mut selected,
            &mut selected_prop,
            diagnostics,
        ) {
            select_targeted_block(
                &targeted,
                &world,
                &mut selected,
                &mut selected_prop,
                diagnostics,
            );
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
        diagnostics,
    ) && !select_targeted_block(
        &targeted,
        &world,
        &mut selected,
        &mut selected_prop,
        diagnostics,
    ) {
        selected.clear();
        selected_prop.clear();
    }
}

fn select_from_editor_ray(
    origin: Vec3,
    direction: Vec3,
    world: &VoxelWorld,
    prop_query: &Query<(
        Entity,
        &Prop,
        &GlobalTransform,
        Option<&EditorPropInstanceId>,
    )>,
    selected: &mut SelectedBlock,
    selected_prop: &mut SelectedProp,
    diagnostics: Option<&EditorDiagnosticsState>,
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
            selected_prop.entity = Some(prop.entity);
            selected_prop.id = Some(prop.id);
            selected_prop.label = Some(prop.label);
            selected_prop.position = Some(prop.position);
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Selection,
                format!(
                    "[editor-selection] selected prop entity={:?} id={} label={} distance={:.2} before_block_distance={:.2}",
                    selected_prop.entity,
                    selected_prop.id.as_deref().unwrap_or("<none>"),
                    selected_prop.label.as_deref().unwrap_or("<none>"),
                    prop.distance,
                    block_distance
                ),
            );
            let _ = block;
            true
        }
        (Some(prop), None) => {
            selected.clear();
            selected_prop.entity = Some(prop.entity);
            selected_prop.id = Some(prop.id);
            selected_prop.label = Some(prop.label);
            selected_prop.position = Some(prop.position);
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Selection,
                format!(
                    "[editor-selection] selected prop entity={:?} id={} label={} distance={:.2}",
                    selected_prop.entity,
                    selected_prop.id.as_deref().unwrap_or("<none>"),
                    selected_prop.label.as_deref().unwrap_or("<none>"),
                    prop.distance
                ),
            );
            true
        }
        (_, Some(((block_pos, normal), _))) => {
            selected_prop.clear();
            selected.position = Some(block_pos);
            selected.normal = Some(normal);
            selected.voxel_type = world.sample_voxel_for_interaction(block_pos).voxel();
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Selection,
                format!(
                    "[editor-selection] selected voxel pos={:?} normal={:?} voxel={:?}",
                    selected.position, selected.normal, selected.voxel_type
                ),
            );
            true
        }
        (None, None) => {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Selection,
                format!(
                    "[editor-selection] no hit origin=({:.2},{:.2},{:.2}) direction=({:.3},{:.3},{:.3})",
                    origin.x, origin.y, origin.z, direction.x, direction.y, direction.z
                ),
            );
            false
        }
    }
}

struct PropHit {
    entity: Entity,
    id: String,
    label: String,
    position: Vec3,
    distance: f32,
}

fn nearest_prop_hit(
    origin: Vec3,
    direction: Vec3,
    max_distance: f32,
    prop_query: &Query<(
        Entity,
        &Prop,
        &GlobalTransform,
        Option<&EditorPropInstanceId>,
    )>,
) -> Option<PropHit> {
    let mut nearest: Option<PropHit> = None;
    for (entity, prop, transform, instance_id) in prop_query.iter() {
        let center = transform.translation();
        let id = prop_runtime_id(entity, instance_id);
        let radius = prop_selection_radius(prop, &id, transform);
        let Some(distance) = ray_sphere_distance(origin, direction, center, radius) else {
            continue;
        };
        if distance > max_distance {
            continue;
        }
        if nearest
            .as_ref()
            .is_some_and(|current| current.distance <= distance)
        {
            continue;
        }

        let label = prop_label(prop, &id);
        nearest = Some(PropHit {
            entity,
            id,
            label,
            position: center,
            distance,
        });
    }

    nearest
}

fn prop_runtime_id(entity: Entity, instance_id: Option<&EditorPropInstanceId>) -> String {
    instance_id
        .map(|id| id.0.clone())
        .unwrap_or_else(|| format!("runtime-prop-{}", entity.index()))
}

fn prop_label(prop: &Prop, id: &str) -> String {
    if prop.id.is_empty() {
        format!("{:?} {}", prop.prop_type, id)
    } else {
        format!("{} ({:?})", prop.id, prop.prop_type)
    }
}

fn prop_selection_radius(prop: &Prop, runtime_id: &str, transform: &GlobalTransform) -> f32 {
    let id = prop.id.to_lowercase();
    let max_scale = transform
        .to_scale_rotation_translation()
        .0
        .max_element()
        .abs()
        .max(1.0);
    let base = if id.contains("building")
        || id.contains("house")
        || id.contains("hut")
        || id.contains("inn")
        || id.contains("stable")
        || runtime_id.contains("building")
    {
        16.0
    } else {
        match prop.prop_type {
            PropType::Tree => 4.5,
            PropType::Rock => 2.5,
            PropType::Bush => 2.0,
            PropType::Flower => 1.25,
        }
    };
    base * max_scale
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
    if far >= 0.0 { Some(far) } else { None }
}

fn select_targeted_block(
    targeted: &TargetedBlock,
    world: &VoxelWorld,
    selected: &mut SelectedBlock,
    selected_prop: &mut SelectedProp,
    diagnostics: Option<&EditorDiagnosticsState>,
) -> bool {
    if let Some(block_pos) = targeted.position {
        selected_prop.clear();
        selected.position = Some(block_pos);
        selected.normal = targeted.normal;
        selected.voxel_type = world.sample_voxel_for_interaction(block_pos).voxel();
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            format!(
                "[editor-selection] selected targeted voxel fallback pos={:?} normal={:?} voxel={:?}",
                selected.position, selected.normal, selected.voxel_type
            ),
        );
        true
    } else {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            "targeted voxel fallback had no target",
        );
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

/// Updates the editor hover target from the actual cursor ray in the native viewport.
pub fn update_targeted_prop_from_cursor_in_editor_viewport(
    windows: Query<&Window, With<PrimaryWindow>>,
    camera_query: Query<(&Camera, &GlobalTransform), With<crate::camera::controller::PlayerCamera>>,
    prop_query: Query<(
        Entity,
        &Prop,
        &GlobalTransform,
        Option<&EditorPropInstanceId>,
    )>,
    mut targeted: ResMut<TargetedProp>,
    diagnostics: Option<Res<EditorDiagnosticsState>>,
    mut debug_state: Local<EditorHoverDebugState>,
) {
    if std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_none() {
        return;
    }

    targeted.entity = None;
    targeted.id = None;
    targeted.label = None;
    targeted.distance = f32::MAX;
    targeted.position = None;
    let diagnostics = diagnostics.as_deref();

    let Ok(window) = windows.single() else {
        if debug_state.last_cursor_available {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Hover,
                "cleared: no primary window",
            );
        }
        debug_state.last_cursor_available = false;
        debug_state.last_ray_available = false;
        debug_state.last_entity = None;
        return;
    };
    let Ok((camera, camera_transform)) = camera_query.single() else {
        if debug_state.last_ray_available {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Hover,
                "cleared: no player camera",
            );
        }
        debug_state.last_cursor_available = window.cursor_position().is_some();
        debug_state.last_ray_available = false;
        debug_state.last_entity = None;
        return;
    };
    let Some(cursor_position) = window.cursor_position() else {
        if debug_state.last_cursor_available {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Hover,
                format!(
                    "[editor-hover] cursor unavailable focused={}",
                    window.focused
                ),
            );
        }
        debug_state.last_cursor_available = false;
        debug_state.last_ray_available = false;
        debug_state.last_entity = None;
        return;
    };
    let Ok(ray) = camera.viewport_to_world(camera_transform, cursor_position) else {
        if debug_state.last_ray_available {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Hover,
                format!(
                    "[editor-hover] cursor ray unavailable cursor=({:.1},{:.1})",
                    cursor_position.x, cursor_position.y
                ),
            );
        }
        debug_state.last_cursor_available = true;
        debug_state.last_ray_available = false;
        debug_state.last_entity = None;
        return;
    };
    let hit = nearest_prop_hit(
        ray.origin,
        ray.direction.as_vec3(),
        EDITOR_SELECTION_RANGE,
        &prop_query,
    );
    let next_entity = hit.as_ref().map(|hit| hit.entity);
    if debug_state.last_entity != next_entity {
        if let Some(hit) = hit.as_ref() {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Hover,
                format!(
                    "[editor-hover] prop entity={:?} id={} label={} distance={:.2} cursor=({:.1},{:.1})",
                    hit.entity,
                    hit.id,
                    hit.label,
                    hit.distance,
                    cursor_position.x,
                    cursor_position.y
                ),
            );
        } else {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Hover,
                format!(
                    "[editor-hover] cleared cursor=({:.1},{:.1})",
                    cursor_position.x, cursor_position.y
                ),
            );
        }
    }
    debug_state.last_cursor_available = true;
    debug_state.last_ray_available = true;
    debug_state.last_entity = next_entity;

    let Some(hit) = hit else {
        return;
    };

    targeted.entity = Some(hit.entity);
    targeted.id = Some(hit.id);
    targeted.label = Some(hit.label);
    targeted.distance = hit.distance;
    targeted.position = Some(hit.position);
}

/// Draws a selection/hover outline around the selected or hovered prop root.
pub fn render_editor_prop_hover_and_selection(
    runtime_debug: Option<Res<crate::runtime_commands::RuntimeViewportDebugState>>,
    selected: Res<SelectedProp>,
    targeted: Res<TargetedProp>,
    props: Query<(
        Entity,
        &Prop,
        &GlobalTransform,
        Option<&EditorPropInstanceId>,
    )>,
    diagnostics: Option<Res<EditorDiagnosticsState>>,
    mut debug_state: Local<EditorHighlightDebugState>,
    mut gizmos: Gizmos,
) {
    let editor_native_viewport = std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_some();
    let diagnostics = diagnostics.as_deref();
    if runtime_debug.is_none() && !editor_native_viewport {
        if !debug_state.reported_initial {
            editor_debug_log(
                diagnostics,
                EditorDiagnosticsCategory::Highlight,
                "runtime debug state missing",
            );
            debug_state.reported_initial = true;
        }
        return;
    }
    let editor_controlled = editor_native_viewport
        || runtime_debug
            .as_ref()
            .is_some_and(|runtime_debug_state| runtime_debug_state.editor_controlled);
    if !debug_state.reported_initial
        || debug_state.last_editor_controlled != editor_controlled
        || debug_state.last_hovered != targeted.entity
        || debug_state.last_selected != selected.entity
    {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Highlight,
            format!(
                "[editor-highlight] editor_controlled={} native_viewport={} hovered={:?} selected={:?}",
                editor_controlled, editor_native_viewport, targeted.entity, selected.entity
            ),
        );
        debug_state.reported_initial = true;
        debug_state.last_editor_controlled = editor_controlled;
        debug_state.last_hovered = targeted.entity;
        debug_state.last_selected = selected.entity;
    }
    if !editor_controlled {
        return;
    }

    if let Some(entity) = targeted.entity {
        if Some(entity) != selected.entity {
            if let Ok((_, prop, transform, instance_id)) = props.get(entity) {
                draw_prop_selection_box(
                    &mut gizmos,
                    prop,
                    transform,
                    &prop_runtime_id(entity, instance_id),
                    Color::srgba(1.0, 1.0, 1.0, 0.55),
                );
            }
        }
    }

    if let Some(entity) = selected.entity {
        if let Ok((_, prop, transform, instance_id)) = props.get(entity) {
            draw_prop_selection_box(
                &mut gizmos,
                prop,
                transform,
                &prop_runtime_id(entity, instance_id),
                Color::srgba(1.0, 0.92, 0.24, 0.9),
            );
        }
    }
}

fn draw_prop_selection_box(
    gizmos: &mut Gizmos,
    prop: &Prop,
    transform: &GlobalTransform,
    runtime_id: &str,
    color: Color,
) {
    let radius = prop_selection_radius(prop, runtime_id, transform).max(0.5);
    let size = Vec3::new(radius * 2.0, radius * 1.35, radius * 2.0);
    let center = transform.translation() + Vec3::Y * (size.y * 0.45);
    let cuboid = Cuboid::new(size.x, size.y, size.z);
    gizmos.primitive_3d(&cuboid, Isometry3d::from_translation(center), color);
}

/// Deletes the selected prop when the native viewport owns keyboard focus.
pub fn delete_selected_prop_in_editor_viewport(
    mut commands: Commands,
    keyboard: Res<ButtonInput<KeyCode>>,
    mut selected_prop: ResMut<SelectedProp>,
    mut selected_block: ResMut<SelectedBlock>,
    props: Query<Entity, With<Prop>>,
    diagnostics: Option<Res<EditorDiagnosticsState>>,
) {
    if std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_none()
        || !(keyboard.just_pressed(KeyCode::Delete) || keyboard.just_pressed(KeyCode::Backspace))
    {
        return;
    }

    let diagnostics = diagnostics.as_deref();
    let Some(entity) = selected_prop.entity else {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            "delete ignored: no selected prop",
        );
        return;
    };
    if props.get(entity).is_err() {
        editor_debug_log(
            diagnostics,
            EditorDiagnosticsCategory::Selection,
            format!(
                "[editor-selection] delete ignored: selected prop entity {:?} no longer exists",
                entity
            ),
        );
        selected_prop.clear();
        return;
    }

    commands.entity(entity).despawn();
    editor_debug_log(
        diagnostics,
        EditorDiagnosticsCategory::Selection,
        format!(
            "[editor-selection] deleted selected prop entity={:?}",
            entity
        ),
    );
    selected_prop.clear();
    selected_block.clear();
}
