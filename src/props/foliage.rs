use bevy::color::Alpha;
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

use crate::camera::controller::PlayerCamera;
use crate::player::Player;
use crate::vegetation::VegetationConfig;
use crate::vegetation::WindState;

#[derive(Resource)]
pub struct FoliageFadeSettings {
    pub near_fade_start: f32,
    pub near_fade_end: f32,
    pub near_fade_min_alpha: f32,
    pub max_update_distance: f32,
    pub max_distance_scale: f32,
    pub front_only: bool,
    pub front_cone_cos: f32,
    pub update_interval: f32,
}

impl Default for FoliageFadeSettings {
    fn default() -> Self {
        Self {
            near_fade_start: 1.0,
            near_fade_end: 3.5,
            near_fade_min_alpha: 0.25,
            max_update_distance: 15.0,
            max_distance_scale: 2.5,
            front_only: false,
            front_cone_cos: 0.2,
            update_interval: 0.1,
        }
    }
}

#[derive(Component)]
pub struct FoliageFade {
    pub base_alpha: f32,
    pub current_alpha: f32,
    pub min_alpha_scale: f32,
    pub distance_scale: f32,
    pub bounds_radius: f32,
    pub base_material: Handle<StandardMaterial>,
    pub blended_material: Option<Handle<StandardMaterial>>,
}

#[derive(Resource)]
pub struct FoliageSpatialIndex {
    pub cell_size: f32,
    pub fade_cells: HashMap<IVec2, Vec<Entity>>,
    pub wind_cells: HashMap<IVec2, Vec<Entity>>,
    pub fade_entities: HashMap<Entity, IVec2>,
    pub wind_entities: HashMap<Entity, IVec2>,
    pub fade_revision: u64,
    pub wind_revision: u64,
}

impl Default for FoliageSpatialIndex {
    fn default() -> Self {
        Self {
            cell_size: 10.0,
            fade_cells: HashMap::new(),
            wind_cells: HashMap::new(),
            fade_entities: HashMap::new(),
            wind_entities: HashMap::new(),
            fade_revision: 0,
            wind_revision: 0,
        }
    }
}

#[derive(Resource, Default)]
pub struct FoliageFadeActive {
    pub entities: HashSet<Entity>,
}

#[derive(Resource)]
pub struct FoliageFadeCandidates {
    pub entities: Vec<Entity>,
    pub last_cell: IVec2,
    pub last_radius: i32,
    pub last_revision: u64,
    pub last_forward: Vec2,
}

impl Default for FoliageFadeCandidates {
    fn default() -> Self {
        Self {
            entities: Vec::new(),
            last_cell: IVec2::new(i32::MIN, i32::MIN),
            last_radius: -1,
            last_revision: 0,
            last_forward: Vec2::ZERO,
        }
    }
}

#[derive(Resource)]
pub struct GrassPropWindSettings {
    pub sway_strength: f32,
    pub sway_speed: f32,
    pub push_radius: f32,
    pub push_strength: f32,
    pub max_effect_distance: f32,
    pub update_interval: f32,
}

impl Default for GrassPropWindSettings {
    fn default() -> Self {
        Self {
            sway_strength: 0.18,
            sway_speed: 0.9,
            push_radius: 1.8,
            push_strength: 0.4,
            max_effect_distance: 30.0,
            update_interval: 0.05,
        }
    }
}

#[derive(Component)]
pub struct GrassPropWind {
    pub base_translation: Vec3,
    pub base_rotation: Quat,
    pub base_scale: Vec3,
    pub phase: f32,
    pub sway_scale: f32,
    pub push_scale: f32,
}

impl GrassPropWind {
    pub fn new(transform: &Transform, seed: f32) -> Self {
        let phase = seed * std::f32::consts::TAU;
        let sway_scale = 0.7 + seed * 0.6;
        let push_scale = 0.8 + (1.0 - seed) * 0.5;
        Self {
            base_translation: transform.translation,
            base_rotation: transform.rotation,
            base_scale: transform.scale,
            phase,
            sway_scale,
            push_scale,
        }
    }
}

pub fn update_foliage_fade(
    time: Res<Time>,
    settings: Res<FoliageFadeSettings>,
    index: Res<FoliageSpatialIndex>,
    mut active: ResMut<FoliageFadeActive>,
    mut candidates: ResMut<FoliageFadeCandidates>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut foliage_query: Query<(&GlobalTransform, &mut MeshMaterial3d<StandardMaterial>, &mut FoliageFade)>,
    mut last_update: Local<f32>,
) {
    let interval = settings.update_interval.max(0.0);
    if interval > 0.0 {
        let now = time.elapsed_secs();
        if now - *last_update < interval {
            return;
        }
        *last_update = now;
    }

    if index.fade_cells.is_empty() && active.entities.is_empty() {
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let camera_pos = camera_transform.translation();
    let camera_forward = (camera_transform.rotation() * -Vec3::Z).normalize_or_zero();

    let max_fade_distance = (settings.near_fade_end * settings.max_distance_scale.max(0.1)).max(0.1);
    let max_distance = settings
        .max_update_distance
        .min(max_fade_distance)
        .min(15.0)
        .max(0.1);
    let max_bounds_radius = (settings.max_distance_scale.max(0.1) * 0.75).clamp(0.5, 3.0);
    let max_distance_with_bounds = max_distance + max_bounds_radius;
    let cell_size = index.cell_size.max(0.1);
    let center_cell = cell_for(camera_pos, cell_size);
    let cell_radius = (max_distance_with_bounds / cell_size).ceil() as i32;
    let mut new_active = HashSet::with_capacity(active.entities.len());
    let front_cone_cos = settings.front_cone_cos.clamp(0.0, 1.0);
    let camera_pos_xz = Vec2::new(camera_pos.x, camera_pos.z);
    let mut forward_xz = Vec2::new(camera_forward.x, camera_forward.z);
    if forward_xz.length_squared() > 0.0001 {
        forward_xz = forward_xz.normalize();
    } else {
        forward_xz = Vec2::Y;
    }
    let forward_changed = candidates.last_forward.length_squared() < 0.0001
        || forward_xz.dot(candidates.last_forward) < 0.98;

    let needs_rebuild = center_cell != candidates.last_cell
        || cell_radius != candidates.last_radius
        || candidates.last_revision != index.fade_revision
        || (settings.front_only && forward_changed);

    if needs_rebuild {
        candidates.entities.clear();
        let cell_half_diag = cell_size * 0.7071;
        let max_distance_with_cell = max_distance_with_bounds + cell_half_diag;
        let max_distance_with_cell_sq = max_distance_with_cell * max_distance_with_cell;

        for x in (center_cell.x - cell_radius)..=(center_cell.x + cell_radius) {
            for z in (center_cell.y - cell_radius)..=(center_cell.y + cell_radius) {
                let cell = IVec2::new(x, z);
                let Some(entities) = index.fade_cells.get(&cell) else {
                    continue;
                };

                let cell_center = Vec2::new(
                    (cell.x as f32 + 0.5) * cell_size,
                    (cell.y as f32 + 0.5) * cell_size,
                );
                let to_cell = cell_center - camera_pos_xz;
                let cell_distance_sq = to_cell.length_squared();
                if cell_distance_sq > max_distance_with_cell_sq {
                    continue;
                }
                if settings.front_only {
                    let dot_raw = forward_xz.dot(to_cell);
                    if dot_raw <= 0.0 {
                        continue;
                    }
                    let dot_sq = dot_raw * dot_raw;
                    let cone_sq = front_cone_cos * front_cone_cos * cell_distance_sq;
                    if dot_sq < cone_sq {
                        continue;
                    }
                }

                candidates.entities.extend(entities.iter().copied());
            }
        }

        candidates.last_cell = center_cell;
        candidates.last_radius = cell_radius;
        candidates.last_revision = index.fade_revision;
        candidates.last_forward = forward_xz;
    }

    for &entity in candidates.entities.iter() {
        let Ok((transform, mut material_handle, mut fade)) = foliage_query.get_mut(entity) else {
            continue;
        };

        let distance_scale = fade.distance_scale.max(0.01);
        let start = (settings.near_fade_start * distance_scale).max(0.0).min(max_distance);
        let end = (settings.near_fade_end * distance_scale).max(start).min(max_distance);
        let min_alpha = (settings.near_fade_min_alpha * fade.min_alpha_scale).clamp(0.0, 1.0);

        let offset = transform.translation() - camera_pos;
        let offset_xz = Vec2::new(offset.x, offset.z);
        let raw_distance = offset.length();
        let distance = (raw_distance - fade.bounds_radius).max(0.0);
        if distance > max_distance {
            continue;
        }
        if settings.front_only {
            let distance_sq_xz = offset_xz.length_squared();
            if distance_sq_xz > 0.0001 {
                let dot_raw = forward_xz.dot(offset_xz);
                if dot_raw <= 0.0 {
                    continue;
                }
                let dot_sq = dot_raw * dot_raw;
                let cone_sq = front_cone_cos * front_cone_cos * distance_sq_xz;
                if dot_sq < cone_sq {
                    continue;
                }
            }
        }

        if distance > end {
            continue;
        }
        let use_blend = end > 0.0001 && distance <= end;

        if use_blend {
            new_active.insert(entity);
            if fade.blended_material.is_none() {
                if let Some(base_material) = materials.get(&fade.base_material) {
                    let mut blended = base_material.clone();
                    blended.alpha_mode = AlphaMode::Blend;
                    blended.base_color.set_alpha(fade.current_alpha.clamp(0.0, 1.0));
                    fade.blended_material = Some(materials.add(blended));
                }
            }

            if let Some(blended_handle) = fade.blended_material.as_ref() {
                if material_handle.0 != *blended_handle {
                    material_handle.0 = blended_handle.clone();
                }
            }

            let target_alpha = if end - start <= 0.0001 {
                fade.base_alpha
            } else {
                let fade_t = smoothstep(start, end, distance);
                (fade.base_alpha * lerp(min_alpha, 1.0, fade_t)).clamp(0.0, 1.0)
            };

            if (target_alpha - fade.current_alpha).abs() < 0.01 {
                continue;
            }

            if let Some(material) = materials.get_mut(&material_handle.0) {
                material.base_color.set_alpha(target_alpha);
                fade.current_alpha = target_alpha;
            }
        } else {
            if material_handle.0 != fade.base_material {
                material_handle.0 = fade.base_material.clone();
            }
            fade.current_alpha = fade.base_alpha;
        }
    }

    let mut previous_active = std::mem::take(&mut active.entities);
    for entity in previous_active.drain() {
        if new_active.contains(&entity) {
            continue;
        }
        let Ok((_transform, mut material_handle, mut fade)) = foliage_query.get_mut(entity) else {
            continue;
        };
        if material_handle.0 != fade.base_material {
            material_handle.0 = fade.base_material.clone();
        }
        fade.current_alpha = fade.base_alpha;
    }

    active.entities = new_active;
}

#[derive(Resource, Default)]
pub struct GrassPropWindActive {
    pub entities: HashSet<Entity>,
}

pub fn update_grass_prop_wind(
    time: Res<Time>,
    wind_state: Option<Res<WindState>>,
    veg_config: Option<Res<VegetationConfig>>,
    settings: Res<GrassPropWindSettings>,
    index: Res<FoliageSpatialIndex>,
    mut active: ResMut<GrassPropWindActive>,
    player_query: Query<&GlobalTransform, With<Player>>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut props_query: Query<(&mut Transform, &GrassPropWind)>,
    mut last_update: Local<f32>,
) {
    let interval = settings.update_interval.max(0.0);
    if interval > 0.0 {
        let now = time.elapsed_secs();
        if now - *last_update < interval {
            return;
        }
        *last_update = now;
    }

    if index.wind_cells.is_empty() && active.entities.is_empty() {
        return;
    }

    let wind_dir = wind_state
        .as_ref()
        .map(|wind| Vec3::new(wind.direction.x, 0.0, wind.direction.y))
        .unwrap_or_else(|| Vec3::new(0.7, 0.0, 0.3));
    let wind_dir = if wind_dir.length_squared() > 0.0001 {
        wind_dir.normalize()
    } else {
        Vec3::X
    };
    let wind_speed = veg_config
        .as_ref()
        .map(|config| config.wind_speed)
        .unwrap_or(1.0);
    let wind_strength = veg_config
        .as_ref()
        .map(|config| config.wind_strength)
        .unwrap_or(1.0);
    let sway_axis = Vec3::Y.cross(wind_dir).normalize_or_zero();
    let sway_axis = if sway_axis.length_squared() > 0.0001 {
        sway_axis
    } else {
        Vec3::Z
    };

    let reference_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation())
        .or_else(|| player_query.single().ok().map(|transform| transform.translation()));

    let Some(reference_pos) = reference_pos else {
        return;
    };

    let t = time.elapsed_secs();
    let max_effect_distance = settings.max_effect_distance.max(settings.push_radius);
    let max_distance_sq = max_effect_distance * max_effect_distance;
    let cell_size = index.cell_size.max(0.1);
    let center_cell = cell_for(reference_pos, cell_size);
    let cell_radius = (max_effect_distance / cell_size).ceil() as i32;
    let mut new_active = HashSet::with_capacity(active.entities.len());

    for x in (center_cell.x - cell_radius)..=(center_cell.x + cell_radius) {
        for z in (center_cell.y - cell_radius)..=(center_cell.y + cell_radius) {
            let cell = IVec2::new(x, z);
            let Some(entities) = index.wind_cells.get(&cell) else {
                continue;
            };

            for &entity in entities {
                let Ok((mut transform, prop)) = props_query.get_mut(entity) else {
                    continue;
                };

                let offset_to_ref = prop.base_translation - reference_pos;
                if offset_to_ref.length_squared() > max_distance_sq {
                    continue;
                }

                new_active.insert(entity);

                let phase = t * settings.sway_speed * wind_speed + prop.phase;
                let sway = phase.sin() * 0.6 + (phase * 0.7).cos() * 0.4;
                let wind_angle = sway * settings.sway_strength * wind_strength * prop.sway_scale;
                let wind_rot = Quat::from_axis_angle(sway_axis, wind_angle);

                let mut push_rot = Quat::IDENTITY;
                let offset = prop.base_translation - reference_pos;
                let horizontal = Vec3::new(offset.x, 0.0, offset.z);
                let distance = horizontal.length();
                if distance > 0.001 && distance < settings.push_radius {
                    let push_dir = horizontal / distance;
                    let axis = Vec3::Y.cross(push_dir).normalize_or_zero();
                    if axis.length_squared() > 0.0001 {
                        let push_t = 1.0 - (distance / settings.push_radius);
                        let push_t = smoothstep(0.0, 1.0, push_t);
                        let push_angle = push_t * settings.push_strength * prop.push_scale;
                        push_rot = Quat::from_axis_angle(axis, push_angle);
                    }
                }

                transform.translation = prop.base_translation;
                transform.rotation = prop.base_rotation * wind_rot * push_rot;
                transform.scale = prop.base_scale;
            }
        }
    }

    let mut previous_active = std::mem::take(&mut active.entities);
    for entity in previous_active.drain() {
        if new_active.contains(&entity) {
            continue;
        }
        let Ok((mut transform, prop)) = props_query.get_mut(entity) else {
            continue;
        };
        if transform.translation != prop.base_translation
            || transform.rotation != prop.base_rotation
            || transform.scale != prop.base_scale
        {
            transform.translation = prop.base_translation;
            transform.rotation = prop.base_rotation;
            transform.scale = prop.base_scale;
        }
    }

    active.entities = new_active;
}

pub fn index_foliage_fade_entities(
    mut index: ResMut<FoliageSpatialIndex>,
    added: Query<(Entity, &GlobalTransform), Added<FoliageFade>>,
    mut removed: RemovedComponents<FoliageFade>,
) {
    let cell_size = index.cell_size.max(0.1);
    let mut changed = false;

    for (entity, transform) in added.iter() {
        let cell = cell_for(transform.translation(), cell_size);
        match index.fade_entities.insert(entity, cell) {
            Some(previous) if previous == cell => {}
            Some(previous) => {
                if let Some(list) = index.fade_cells.get_mut(&previous) {
                    list.retain(|&e| e != entity);
                    if list.is_empty() {
                        index.fade_cells.remove(&previous);
                    }
                }
                index.fade_cells.entry(cell).or_default().push(entity);
            }
            None => {
                index.fade_cells.entry(cell).or_default().push(entity);
            }
        }
        changed = true;
    }

    for entity in removed.read() {
        if let Some(cell) = index.fade_entities.remove(&entity) {
            if let Some(list) = index.fade_cells.get_mut(&cell) {
                list.retain(|&e| e != entity);
                if list.is_empty() {
                    index.fade_cells.remove(&cell);
                }
            }
            changed = true;
        }
    }

    if changed {
        index.fade_revision = index.fade_revision.wrapping_add(1);
    }
}

pub fn index_grass_prop_wind_entities(
    mut index: ResMut<FoliageSpatialIndex>,
    added: Query<(Entity, &GrassPropWind), Added<GrassPropWind>>,
    mut removed: RemovedComponents<GrassPropWind>,
) {
    let cell_size = index.cell_size.max(0.1);
    let mut changed = false;

    for (entity, wind) in added.iter() {
        let cell = cell_for(wind.base_translation, cell_size);
        index.wind_cells.entry(cell).or_default().push(entity);
        index.wind_entities.insert(entity, cell);
        changed = true;
    }

    for entity in removed.read() {
        if let Some(cell) = index.wind_entities.remove(&entity) {
            if let Some(list) = index.wind_cells.get_mut(&cell) {
                list.retain(|&e| e != entity);
                if list.is_empty() {
                    index.wind_cells.remove(&cell);
                }
            }
            changed = true;
        }
    }

    if changed {
        index.wind_revision = index.wind_revision.wrapping_add(1);
    }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn cell_for(position: Vec3, cell_size: f32) -> IVec2 {
    let size = cell_size.max(0.1);
    IVec2::new(
        (position.x / size).floor() as i32,
        (position.z / size).floor() as i32,
    )
}
