//! Construction persistence, deletion helpers, and terrain-conform request diagnostics.

use bevy::math::primitives::Cuboid;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::camera::controller::PlayerCamera;
use crate::rendering::building_material::{
    BuildingMaterialHandle, BuildingMaterialType, BuildingMesh,
};
use crate::voxel::world::VoxelWorld;

use super::grid::{BuildingGrid, SnapPointIndex};
use super::stability::{DirtyStabilityIslands, Stability};
use super::types::{
    BuildingPiece, BuildingPieceRegistry, BuildingState, PieceCategory, PieceTypeId,
};

const CONSTRUCTION_SAVE_PATH: &str = "saves/construction/placed_pieces.json";
const ENTITY_ID_PREFIX: &str = "piece-";
const ROTATION_QUARTER_COUNT: u8 = 4;
const AIM_DELETE_RANGE_M: f32 = 16.0;
const OVERLAP_PADDING_M: f32 = 0.02;

#[derive(Resource, Clone, Debug)]
pub struct ConstructionPersistenceConfig {
    pub enabled: bool,
    pub path: PathBuf,
}

impl Default for ConstructionPersistenceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            path: PathBuf::from(CONSTRUCTION_SAVE_PATH),
        }
    }
}

#[derive(Resource, Debug)]
pub struct ConstructionPersistenceState {
    pub loaded: bool,
    next_id: u64,
}

impl Default for ConstructionPersistenceState {
    fn default() -> Self {
        Self {
            loaded: false,
            next_id: 1,
        }
    }
}

impl ConstructionPersistenceState {
    pub fn allocate_id(&mut self) -> String {
        let id = format!("{ENTITY_ID_PREFIX}{}", self.next_id);
        self.next_id += 1;
        id
    }

    fn observe_id(&mut self, id: &str) {
        let Some(raw) = id.strip_prefix(ENTITY_ID_PREFIX) else {
            return;
        };
        let Ok(value) = raw.parse::<u64>() else {
            return;
        };
        self.next_id = self.next_id.max(value + 1);
    }
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct ConstructionTerrainConformConfig {
    pub enabled: bool,
    pub pad_margin_m: f32,
    pub fill_depth_m: f32,
    pub trim_height_m: f32,
    pub falloff_m: f32,
    pub material_slot: u8,
}

impl Default for ConstructionTerrainConformConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            pad_margin_m: 0.35,
            fill_depth_m: 1.5,
            trim_height_m: 0.45,
            falloff_m: 0.25,
            material_slot: 0,
        }
    }
}

#[derive(Message, Clone, Debug, PartialEq)]
pub struct ConstructionTerrainConformRequest {
    pub piece_id: String,
    pub position: [f32; 3],
    pub dimensions_m: [f32; 3],
    pub rotation_quarter_turns: u8,
    pub material_slot: u8,
    pub pad_margin_m: f32,
    pub fill_depth_m: f32,
    pub trim_height_m: f32,
    pub falloff_m: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConstructionPiece {
    pub id: String,
    pub type_id: String,
    pub position: [f32; 3],
    pub rotation_quarter_turns: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grounded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_ids: Option<Vec<String>>,
}

#[derive(Debug, Error)]
pub enum ConstructionPersistenceError {
    #[error("Failed to access construction save '{path}': {source}")]
    FileAccess {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Failed to serialize construction save: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub fn load_saved_construction_pieces(
    mut commands: Commands,
    config: Res<ConstructionPersistenceConfig>,
    mut state: ResMut<ConstructionPersistenceState>,
    registry: Res<BuildingPieceRegistry>,
    world: Res<VoxelWorld>,
    mut grid: ResMut<BuildingGrid>,
    mut dirty_stability: ResMut<DirtyStabilityIslands>,
    mut meshes: ResMut<Assets<Mesh>>,
    building_mat_handle: Option<Res<BuildingMaterialHandle>>,
    mut standard_materials: ResMut<Assets<StandardMaterial>>,
) {
    if state.loaded || !config.enabled || registry.pieces.is_empty() {
        return;
    }
    state.loaded = true;

    let pieces = match read_construction_save(&config.path) {
        Ok(Some(pieces)) => pieces,
        Ok(None) => return,
        Err(error) => {
            warn!("Failed to load saved construction pieces: {error}");
            return;
        }
    };

    let mut pending = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut rewrite_storage = false;
    for mut saved in pieces {
        normalize_saved_piece(&mut saved);
        if saved.id.is_empty() || !seen_ids.insert(saved.id.clone()) {
            rewrite_storage = true;
            continue;
        }
        if saved.grounded.is_none() && saved.parent_ids.is_none() {
            warn!(
                "Skipped saved construction piece {}: missing support metadata",
                saved.id
            );
            rewrite_storage = true;
            continue;
        }
        state.observe_id(&saved.id);
        pending.push(saved);
    }

    let mut loaded = Vec::<SavedConstructionPiece>::new();
    let mut loaded_entities = HashMap::<String, Entity>::new();
    let mut made_progress = true;
    while !pending.is_empty() && made_progress {
        made_progress = false;
        let mut index = 0;
        while index < pending.len() {
            let saved = pending[index].clone();
            match validate_saved_piece(&saved, &loaded, &registry, &world) {
                Ok(()) => {
                    if let Some(entity) = spawn_saved_piece(
                        &mut commands,
                        &saved,
                        &registry,
                        &mut grid,
                        &mut dirty_stability,
                        &mut meshes,
                        building_mat_handle.as_deref(),
                        &mut standard_materials,
                    ) {
                        for parent_id in saved.parent_ids.as_deref().unwrap_or_default() {
                            if let Some(parent_entity) = loaded_entities.get(parent_id) {
                                grid.connect(entity, *parent_entity);
                            }
                        }
                        loaded_entities.insert(saved.id.clone(), entity);
                        loaded.push(saved);
                        pending.remove(index);
                        made_progress = true;
                    } else {
                        rewrite_storage = true;
                        pending.remove(index);
                    }
                }
                Err("unsupported") => {
                    index += 1;
                }
                Err(reason) => {
                    warn!(
                        "Skipped saved construction piece {}: {reason}",
                        pending[index].id
                    );
                    rewrite_storage = true;
                    pending.remove(index);
                }
            }
        }
    }

    if !pending.is_empty() {
        for saved in pending {
            warn!("Skipped saved construction piece {}: unsupported", saved.id);
        }
        rewrite_storage = true;
    }

    if rewrite_storage {
        let snapshot = loaded;
        if let Err(error) = write_construction_save(&config.path, &snapshot) {
            warn!("Failed to rewrite construction save after validation: {error}");
        }
    }
}

pub fn delete_aimed_building_piece(
    mut commands: Commands,
    state: Res<BuildingState>,
    config: Res<ConstructionPersistenceConfig>,
    mouse: Res<ButtonInput<MouseButton>>,
    camera: Query<&Transform, With<PlayerCamera>>,
    registry: Res<BuildingPieceRegistry>,
    mut grid: ResMut<BuildingGrid>,
    mut snap_index: ResMut<SnapPointIndex>,
    mut dirty_stability: ResMut<DirtyStabilityIslands>,
    pieces: Query<(Entity, &BuildingPiece, &Transform)>,
) {
    if !state.active || !mouse.just_pressed(MouseButton::Right) {
        return;
    }
    let Ok(camera_transform) = camera.single() else {
        return;
    };

    let Some((target, _, _)) = aimed_piece(
        camera_transform.translation,
        camera_transform.forward().as_vec3(),
        AIM_DELETE_RANGE_M,
        &registry,
        &pieces,
    ) else {
        return;
    };
    let Ok((_, target_piece, _)) = pieces.get(target) else {
        return;
    };
    let removed_ids = dependent_piece_ids(&target_piece.stable_id, &pieces);
    let snapshot = saved_snapshot(&pieces, None, &removed_ids);

    for (entity, piece, _) in &pieces {
        if !removed_ids.contains(&piece.stable_id) {
            continue;
        }
        for neighbor in grid.remove_entity(entity) {
            dirty_stability.mark(neighbor);
        }
        snap_index.remove_entity(entity);
        commands.entity(entity).despawn();
    }

    if config.enabled {
        if let Err(error) = write_construction_save(&config.path, &snapshot) {
            warn!("Failed to save construction after deletion: {error}");
        }
    }
}

pub fn log_unsupported_terrain_conform_requests(
    mut requests: MessageReader<ConstructionTerrainConformRequest>,
) {
    for request in requests.read() {
        warn!(
            "Construction terrain conform request for {} at {:?} was recorded but not applied; no safe foundation terrain mutation consumer is wired.",
            request.piece_id, request.position
        );
    }
}

pub fn save_snapshot_with_extra(
    config: &ConstructionPersistenceConfig,
    pieces: &Query<(Entity, &BuildingPiece, &Transform)>,
    extra: SavedConstructionPiece,
) {
    if !config.enabled {
        return;
    }
    let excluded = HashSet::new();
    let snapshot = saved_snapshot(pieces, Some(extra), &excluded);
    if let Err(error) = write_construction_save(&config.path, &snapshot) {
        warn!("Failed to save construction pieces: {error}");
    }
}

pub fn saved_piece_from_runtime(
    piece: &BuildingPiece,
    transform: &Transform,
) -> SavedConstructionPiece {
    SavedConstructionPiece {
        id: piece.stable_id.clone(),
        type_id: piece.piece_type.0.to_string(),
        position: transform.translation.to_array(),
        rotation_quarter_turns: piece.rotation % ROTATION_QUARTER_COUNT,
        material: Some(material_to_id(piece.material).to_string()),
        grounded: Some(piece.grounded),
        parent_ids: Some(piece.parent_ids.clone()),
    }
}

pub fn saved_piece_for_new_runtime(
    stable_id: String,
    piece_type: PieceTypeId,
    position: Vec3,
    rotation: u8,
    material: BuildingMaterialType,
    grounded: bool,
    parent_ids: Vec<String>,
) -> SavedConstructionPiece {
    SavedConstructionPiece {
        id: stable_id,
        type_id: piece_type.0.to_string(),
        position: position.to_array(),
        rotation_quarter_turns: rotation % ROTATION_QUARTER_COUNT,
        material: Some(material_to_id(material).to_string()),
        grounded: Some(grounded),
        parent_ids: Some(parent_ids),
    }
}

pub fn maybe_request_terrain_conform(
    writer: &mut MessageWriter<ConstructionTerrainConformRequest>,
    config: ConstructionTerrainConformConfig,
    piece_id: PieceTypeId,
    category: PieceCategory,
    dimensions: Vec3,
    position: Vec3,
    rotation: u8,
) {
    if !config.enabled || !matches!(category, PieceCategory::Foundation | PieceCategory::Floor) {
        return;
    }
    writer.write(ConstructionTerrainConformRequest {
        piece_id: piece_id.0.to_string(),
        position: position.to_array(),
        dimensions_m: dimensions.to_array(),
        rotation_quarter_turns: rotation % ROTATION_QUARTER_COUNT,
        material_slot: config.material_slot,
        pad_margin_m: config.pad_margin_m,
        fill_depth_m: config.fill_depth_m,
        trim_height_m: config.trim_height_m,
        falloff_m: config.falloff_m,
    });
}

fn read_construction_save(
    path: &Path,
) -> Result<Option<Vec<SavedConstructionPiece>>, ConstructionPersistenceError> {
    if !path.exists() {
        return Ok(None);
    }
    let file = File::open(path).map_err(|source| ConstructionPersistenceError::FileAccess {
        path: path.display().to_string(),
        source,
    })?;
    let reader = BufReader::new(file);
    Ok(Some(serde_json::from_reader(reader)?))
}

fn write_construction_save(
    path: &Path,
    pieces: &[SavedConstructionPiece],
) -> Result<(), ConstructionPersistenceError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|source| {
                ConstructionPersistenceError::FileAccess {
                    path: parent.display().to_string(),
                    source,
                }
            })?;
        }
    }
    let file = File::create(path).map_err(|source| ConstructionPersistenceError::FileAccess {
        path: path.display().to_string(),
        source,
    })?;
    serde_json::to_writer_pretty(BufWriter::new(file), pieces)?;
    Ok(())
}

fn normalize_saved_piece(saved: &mut SavedConstructionPiece) {
    saved.id = saved.id.trim().to_string();
    saved.type_id = saved.type_id.trim().to_string();
    saved.rotation_quarter_turns %= ROTATION_QUARTER_COUNT;
    if let Some(material) = &mut saved.material {
        *material = material.trim().to_ascii_lowercase();
    }
    if let Some(parents) = &mut saved.parent_ids {
        parents.retain(|id| !id.is_empty());
        parents.sort();
        parents.dedup();
    }
}

fn validate_saved_piece(
    saved: &SavedConstructionPiece,
    loaded: &[SavedConstructionPiece],
    registry: &BuildingPieceRegistry,
    world: &VoxelWorld,
) -> Result<(), &'static str> {
    if !saved.position.iter().all(|value| value.is_finite()) {
        return Err("invalid position");
    }
    let piece_type = parse_piece_type_id(&saved.type_id)?;
    let Some(definition) = registry.get(piece_type) else {
        return Err("unknown type");
    };
    if saved
        .material
        .as_deref()
        .is_some_and(material_from_id_opt_invalid)
    {
        return Err("invalid material");
    }

    match saved.grounded {
        Some(true) if definition.can_ground => {}
        Some(true) => return Err("invalid support"),
        Some(false) => {
            let parents = saved.parent_ids.as_deref().unwrap_or_default();
            if !parents
                .iter()
                .any(|parent| saved_piece_supported(loaded, parent))
            {
                return Err("unsupported");
            }
        }
        None => return Err("missing support"),
    }

    let bounds = world.bounds();
    let position = Vec3::from(saved.position);
    let half = rotated_dimensions(definition.dimensions, saved.rotation_quarter_turns) * 0.5;
    let min = position - half;
    let max = position + half;
    if min.x < bounds.horizontal_min.x as f32
        || max.x > (bounds.horizontal_max.x + 1) as f32
        || min.z < bounds.horizontal_min.y as f32
        || max.z > (bounds.horizontal_max.y + 1) as f32
        || min.y < bounds.min_world_y as f32
        || max.y > (bounds.max_world_y + 1) as f32
    {
        return Err("outside world");
    }

    for other in loaded {
        let other_type = parse_piece_type_id(&other.type_id)?;
        let Some(other_definition) = registry.get(other_type) else {
            continue;
        };
        if bounds_overlap(
            position,
            definition.dimensions,
            saved.rotation_quarter_turns,
            Vec3::from(other.position),
            other_definition.dimensions,
            other.rotation_quarter_turns,
        ) {
            return Err("overlap");
        }
    }

    Ok(())
}

fn spawn_saved_piece(
    commands: &mut Commands,
    saved: &SavedConstructionPiece,
    registry: &BuildingPieceRegistry,
    grid: &mut BuildingGrid,
    dirty_stability: &mut DirtyStabilityIslands,
    meshes: &mut Assets<Mesh>,
    building_mat_handle: Option<&BuildingMaterialHandle>,
    standard_materials: &mut Assets<StandardMaterial>,
) -> Option<Entity> {
    let Ok(piece_type) = parse_piece_type_id(&saved.type_id) else {
        return None;
    };
    let Some(definition) = registry.get(piece_type) else {
        return None;
    };
    let material = saved
        .material
        .as_deref()
        .and_then(material_from_id)
        .unwrap_or(definition.material);
    let position = Vec3::from(saved.position);
    let rotation = saved.rotation_quarter_turns % ROTATION_QUARTER_COUNT;
    let transform = Transform::from_translation(position).with_rotation(Quat::from_rotation_y(
        rotation as f32 * std::f32::consts::FRAC_PI_2,
    ));
    let mesh = meshes.add(Cuboid::new(
        definition.dimensions.x,
        definition.dimensions.y,
        definition.dimensions.z,
    ));
    let grid_position = grid.world_to_cell(position);
    let piece = BuildingPiece {
        stable_id: saved.id.clone(),
        piece_type,
        grid_position,
        rotation,
        material,
        grounded: saved.grounded.unwrap_or(false),
        parent_ids: saved.parent_ids.clone().unwrap_or_default(),
    };
    let stability = Stability {
        value: 0.0,
        grounded: piece.grounded,
    };
    let entity = if let Some(handle) = building_mat_handle {
        commands
            .spawn((
                Mesh3d(mesh),
                MeshMaterial3d(handle.handle.clone()),
                transform,
                piece,
                stability,
                BuildingMesh {
                    material_type: material,
                },
            ))
            .id()
    } else {
        let material_handle = standard_materials.add(StandardMaterial {
            base_color: fallback_material_color(material),
            ..default()
        });
        commands
            .spawn((
                Mesh3d(mesh),
                MeshMaterial3d(material_handle),
                transform,
                piece,
                stability,
            ))
            .id()
    };
    grid.insert(grid_position, entity);
    dirty_stability.mark(entity);
    Some(entity)
}

fn saved_snapshot(
    pieces: &Query<(Entity, &BuildingPiece, &Transform)>,
    extra: Option<SavedConstructionPiece>,
    excluded_ids: &HashSet<String>,
) -> Vec<SavedConstructionPiece> {
    let mut snapshot = pieces
        .iter()
        .filter(|(_, piece, _)| !excluded_ids.contains(&piece.stable_id))
        .map(|(_, piece, transform)| saved_piece_from_runtime(piece, transform))
        .collect::<Vec<_>>();
    if let Some(extra) = extra {
        snapshot.push(extra);
    }
    snapshot.sort_by(|a, b| a.id.cmp(&b.id));
    snapshot
}

fn aimed_piece(
    origin: Vec3,
    direction: Vec3,
    max_distance: f32,
    registry: &BuildingPieceRegistry,
    pieces: &Query<(Entity, &BuildingPiece, &Transform)>,
) -> Option<(Entity, f32, String)> {
    let dir = direction.normalize_or_zero();
    if dir.length_squared() <= f32::EPSILON {
        return None;
    }
    pieces
        .iter()
        .filter_map(|(entity, piece, transform)| {
            let definition = registry.get(piece.piece_type)?;
            let distance = ray_intersects_piece(origin, dir, transform, definition.dimensions)?;
            (distance <= max_distance).then(|| (entity, distance, piece.stable_id.clone()))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
}

fn ray_intersects_piece(
    origin: Vec3,
    direction: Vec3,
    transform: &Transform,
    size: Vec3,
) -> Option<f32> {
    let inverse_rotation = transform.rotation.conjugate();
    let local_origin = inverse_rotation * (origin - transform.translation);
    let local_direction = inverse_rotation * direction;
    let half = size * 0.5;
    ray_intersects_aabb(local_origin, local_direction, -half, half)
}

fn ray_intersects_aabb(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3) -> Option<f32> {
    let mut t_min = 0.0f32;
    let mut t_max = f32::INFINITY;
    for axis in 0..3 {
        let o = origin[axis];
        let d = direction[axis];
        let min_axis = min[axis];
        let max_axis = max[axis];
        if d.abs() <= f32::EPSILON {
            if o < min_axis || o > max_axis {
                return None;
            }
            continue;
        }
        let inv = 1.0 / d;
        let mut near = (min_axis - o) * inv;
        let mut far = (max_axis - o) * inv;
        if near > far {
            std::mem::swap(&mut near, &mut far);
        }
        t_min = t_min.max(near);
        t_max = t_max.min(far);
        if t_min > t_max {
            return None;
        }
    }
    Some(t_min.max(0.0))
}

fn dependent_piece_ids(
    root_id: &str,
    pieces: &Query<(Entity, &BuildingPiece, &Transform)>,
) -> HashSet<String> {
    dependent_piece_ids_from_iter(root_id, pieces.iter().map(|(_, piece, _)| piece))
}

fn dependent_piece_ids_from_iter<'a>(
    root_id: &str,
    pieces: impl Iterator<Item = &'a BuildingPiece> + Clone,
) -> HashSet<String> {
    let mut result = HashSet::from([root_id.to_string()]);
    let mut changed = true;
    while changed {
        changed = false;
        for piece in pieces.clone() {
            if result.contains(&piece.stable_id) {
                continue;
            }
            if piece
                .parent_ids
                .iter()
                .any(|parent| result.contains(parent))
            {
                result.insert(piece.stable_id.clone());
                changed = true;
            }
        }
    }
    result
}

fn saved_piece_supported(loaded: &[SavedConstructionPiece], id: &str) -> bool {
    fn visit(
        loaded: &[SavedConstructionPiece],
        id: &str,
        visiting: &mut HashSet<String>,
        depth: usize,
    ) -> bool {
        if depth >= 64 || !visiting.insert(id.to_string()) {
            return false;
        }
        let Some(piece) = loaded.iter().find(|piece| piece.id == id) else {
            return false;
        };
        if piece.grounded == Some(true) {
            return true;
        }
        piece
            .parent_ids
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|parent| visit(loaded, parent, visiting, depth + 1))
    }
    visit(loaded, id, &mut HashSet::new(), 0)
}

fn parse_piece_type_id(value: &str) -> Result<PieceTypeId, &'static str> {
    value
        .parse::<u32>()
        .map(PieceTypeId)
        .map_err(|_| "unknown type")
}

fn material_to_id(material: BuildingMaterialType) -> &'static str {
    match material {
        BuildingMaterialType::WoodPlank => "wood",
        BuildingMaterialType::StoneBrick => "stone",
        BuildingMaterialType::MetalPlate => "metal",
        BuildingMaterialType::Thatch => "thatch",
    }
}

fn material_from_id(value: &str) -> Option<BuildingMaterialType> {
    match value {
        "wood" | "wood-plank" | "wood_plank" => Some(BuildingMaterialType::WoodPlank),
        "brick" | "stone" | "stone-brick" | "stone_brick" => Some(BuildingMaterialType::StoneBrick),
        "metal" | "metal-plate" | "metal_plate" => Some(BuildingMaterialType::MetalPlate),
        "thatch" => Some(BuildingMaterialType::Thatch),
        _ => None,
    }
}

fn material_from_id_opt_invalid(value: &str) -> bool {
    material_from_id(value).is_none()
}

fn fallback_material_color(material: BuildingMaterialType) -> Color {
    match material {
        BuildingMaterialType::WoodPlank => Color::srgb(0.6, 0.4, 0.2),
        BuildingMaterialType::StoneBrick => Color::srgb(0.5, 0.5, 0.5),
        BuildingMaterialType::MetalPlate => Color::srgb(0.4, 0.4, 0.45),
        BuildingMaterialType::Thatch => Color::srgb(0.7, 0.6, 0.3),
    }
}

fn rotated_dimensions(size: Vec3, rotation: u8) -> Vec3 {
    if rotation % 2 == 0 {
        size
    } else {
        Vec3::new(size.z, size.y, size.x)
    }
}

fn bounds_overlap(
    a_pos: Vec3,
    a_size: Vec3,
    a_rotation: u8,
    b_pos: Vec3,
    b_size: Vec3,
    b_rotation: u8,
) -> bool {
    let a_half = (rotated_dimensions(a_size, a_rotation) * 0.5 - Vec3::splat(OVERLAP_PADDING_M))
        .max(Vec3::ZERO);
    let b_half = (rotated_dimensions(b_size, b_rotation) * 0.5 - Vec3::splat(OVERLAP_PADDING_M))
        .max(Vec3::ZERO);
    let a_min = a_pos - a_half;
    let a_max = a_pos + a_half;
    let b_min = b_pos - b_half;
    let b_max = b_pos + b_half;
    a_min.x <= b_max.x
        && a_max.x >= b_min.x
        && a_min.y <= b_max.y
        && a_max.y >= b_min.y
        && a_min.z <= b_max.z
        && a_max.z >= b_min.z
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::building_material::BuildingMaterialType;
    use crate::voxel::world::VoxelWorld;

    fn registry() -> BuildingPieceRegistry {
        let mut registry = BuildingPieceRegistry::default();
        registry.register(super::super::types::PieceDefinition::floor(
            1,
            "Floor",
            BuildingMaterialType::WoodPlank,
        ));
        registry.register(super::super::types::PieceDefinition::wall(
            2,
            "Wall",
            BuildingMaterialType::WoodPlank,
        ));
        registry
    }

    fn saved(
        id: &str,
        type_id: &str,
        grounded: bool,
        parents: Vec<&str>,
    ) -> SavedConstructionPiece {
        SavedConstructionPiece {
            id: id.to_string(),
            type_id: type_id.to_string(),
            position: [2.0, 2.0, 2.0],
            rotation_quarter_turns: 0,
            material: Some("wood".to_string()),
            grounded: Some(grounded),
            parent_ids: Some(parents.into_iter().map(str::to_string).collect()),
        }
    }

    #[test]
    fn saved_support_accepts_connected_parent_chain() {
        let registry = registry();
        let world = VoxelWorld::new(IVec3::splat(4));
        let floor = saved("floor-1", "1", true, vec![]);
        let mut wall = saved("wall-1", "2", false, vec!["floor-1"]);
        wall.position = [2.0, 4.0, 2.0];

        assert!(validate_saved_piece(&floor, &[], &registry, &world).is_ok());
        assert!(validate_saved_piece(&wall, &[floor], &registry, &world).is_ok());
    }

    #[test]
    fn saved_support_rejects_missing_support_metadata() {
        let registry = registry();
        let world = VoxelWorld::new(IVec3::splat(4));
        let mut floor = saved("floor-1", "1", true, vec![]);
        floor.grounded = None;
        floor.parent_ids = None;

        assert_eq!(
            validate_saved_piece(&floor, &[], &registry, &world),
            Err("missing support")
        );
    }

    #[test]
    fn dependent_piece_ids_follow_parent_chains() {
        let mut app = App::new();
        let parent = app
            .world_mut()
            .spawn((
                BuildingPiece {
                    stable_id: "parent".to_string(),
                    piece_type: PieceTypeId(1),
                    grid_position: IVec3::ZERO,
                    rotation: 0,
                    material: BuildingMaterialType::WoodPlank,
                    grounded: true,
                    parent_ids: vec![],
                },
                Transform::default(),
            ))
            .id();
        let _child = app.world_mut().spawn((
            BuildingPiece {
                stable_id: "child".to_string(),
                piece_type: PieceTypeId(2),
                grid_position: IVec3::Y,
                rotation: 0,
                material: BuildingMaterialType::WoodPlank,
                grounded: false,
                parent_ids: vec!["parent".to_string()],
            },
            Transform::default(),
        ));
        let mut query = app
            .world_mut()
            .query::<(Entity, &BuildingPiece, &Transform)>();
        let pieces = query
            .iter(app.world())
            .map(|(_, piece, _)| piece)
            .collect::<Vec<_>>();
        let ids = dependent_piece_ids_from_iter(
            &app.world().get::<BuildingPiece>(parent).unwrap().stable_id,
            pieces.into_iter(),
        );
        assert!(ids.contains("parent"));
        assert!(ids.contains("child"));
    }
}
