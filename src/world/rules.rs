use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use crate::constants::{CHUNK_SIZE_F32, CHUNK_SIZE_I32};

pub const WORLD_RULES_SCHEMA_VERSION: u32 = 1;
pub const WORLD_RULES_PATH: &str = "world-rules.json";

#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProtectedAreaId(pub String);

impl ProtectedAreaId {
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedAreaKind {
    #[serde(alias = "story_lock")]
    Unbreakable,
    NoDig,
    NoBuild,
    #[serde(alias = "no_prop")]
    NoProps,
    QuestLock,
    #[serde(alias = "spawn")]
    SpawnProtection,
    Custom,
}

impl ProtectedAreaKind {
    pub fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Unbreakable => "unbreakable",
            Self::NoDig => "no_dig",
            Self::NoBuild => "no_build",
            Self::NoProps => "no_prop",
            Self::QuestLock => "quest_lock",
            Self::SpawnProtection => "spawn",
            Self::Custom => "custom",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtectedAreaShape {
    Box,
    Sphere,
    Cylinder,
    ChunkSet,
    Polygon,
}

impl ProtectedAreaShape {
    pub fn as_frontend_str(self) -> &'static str {
        match self {
            Self::Box => "box",
            Self::Sphere => "sphere",
            Self::Cylinder => "cylinder",
            Self::ChunkSet => "chunk_set",
            Self::Polygon => "polygon",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedAreaRuleMatrix {
    pub can_mine: bool,
    pub can_place: bool,
    pub can_paint: bool,
    pub can_spawn_props: bool,
    pub can_edit_water: bool,
    pub can_save_modify: bool,
}

impl ProtectedAreaRuleMatrix {
    pub const ALLOW_ALL: Self = Self {
        can_mine: true,
        can_place: true,
        can_paint: true,
        can_spawn_props: true,
        can_edit_water: true,
        can_save_modify: true,
    };

    pub fn effective_for_kind(self, kind: ProtectedAreaKind) -> Self {
        let kind_rules = match kind {
            ProtectedAreaKind::Unbreakable | ProtectedAreaKind::QuestLock => Self {
                can_mine: false,
                can_place: false,
                can_paint: false,
                can_spawn_props: false,
                can_edit_water: false,
                can_save_modify: false,
            },
            ProtectedAreaKind::NoDig => Self {
                can_mine: false,
                ..Self::ALLOW_ALL
            },
            ProtectedAreaKind::NoBuild => Self {
                can_place: false,
                ..Self::ALLOW_ALL
            },
            ProtectedAreaKind::NoProps => Self {
                can_spawn_props: false,
                ..Self::ALLOW_ALL
            },
            ProtectedAreaKind::SpawnProtection => Self {
                can_mine: false,
                can_paint: false,
                can_edit_water: false,
                ..Self::ALLOW_ALL
            },
            ProtectedAreaKind::Custom => Self::ALLOW_ALL,
        };

        Self {
            can_mine: self.can_mine && kind_rules.can_mine,
            can_place: self.can_place && kind_rules.can_place,
            can_paint: self.can_paint && kind_rules.can_paint,
            can_spawn_props: self.can_spawn_props && kind_rules.can_spawn_props,
            can_edit_water: self.can_edit_water && kind_rules.can_edit_water,
            can_save_modify: self.can_save_modify && kind_rules.can_save_modify,
        }
    }

    pub fn allows(self, intent: ProtectedEditIntent) -> bool {
        match intent {
            ProtectedEditIntent::Mine => self.can_mine,
            ProtectedEditIntent::Place => self.can_place,
            ProtectedEditIntent::Paint => self.can_paint,
            ProtectedEditIntent::SpawnProps => self.can_spawn_props,
            ProtectedEditIntent::EditWater => self.can_edit_water,
            ProtectedEditIntent::SaveModify => self.can_save_modify,
        }
    }
}

impl Default for ProtectedAreaRuleMatrix {
    fn default() -> Self {
        Self::ALLOW_ALL
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProtectedAreaBounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl ProtectedAreaBounds {
    pub fn normalized(self) -> Self {
        Self {
            min: [
                self.min[0].min(self.max[0]),
                self.min[1].min(self.max[1]),
                self.min[2].min(self.max[2]),
            ],
            max: [
                self.min[0].max(self.max[0]),
                self.min[1].max(self.max[1]),
                self.min[2].max(self.max[2]),
            ],
        }
    }

    fn min_vec(self) -> Vec3 {
        Vec3::new(self.min[0], self.min[1], self.min[2])
    }

    fn max_vec(self) -> Vec3 {
        Vec3::new(self.max[0], self.max[1], self.max[2])
    }

    fn intersects(self, other: Self) -> bool {
        let a = self.normalized();
        let b = other.normalized();
        a.min[0] <= b.max[0]
            && a.max[0] >= b.min[0]
            && a.min[1] <= b.max[1]
            && a.max[1] >= b.min[1]
            && a.min[2] <= b.max[2]
            && a.max[2] >= b.min[2]
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedArea {
    pub id: ProtectedAreaId,
    pub name: String,
    pub kind: ProtectedAreaKind,
    pub shape: ProtectedAreaShape,
    pub priority: i32,
    pub locked: bool,
    pub color: String,
    pub center: [f32; 3],
    pub size: [f32; 3],
    pub bounds: ProtectedAreaBounds,
    pub rules: ProtectedAreaRuleMatrix,
    #[serde(default)]
    pub chunks: Vec<[i32; 3]>,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub debug_label: Option<String>,
}

fn default_schema_version() -> u32 {
    WORLD_RULES_SCHEMA_VERSION
}

impl ProtectedArea {
    pub fn point_in_area(&self, position: Vec3) -> bool {
        let bounds = self.bounds.normalized();
        match self.shape {
            ProtectedAreaShape::Box | ProtectedAreaShape::Polygon => {
                point_in_bounds(position, bounds)
            }
            ProtectedAreaShape::Sphere => {
                let center = array_to_vec3(self.center);
                let radius = self.size.iter().copied().fold(0.0_f32, f32::max).max(0.0) * 0.5;
                position.distance_squared(center) <= radius * radius
            }
            ProtectedAreaShape::Cylinder => {
                let center = array_to_vec3(self.center);
                let radius = self.size[0].abs().max(self.size[2].abs()) * 0.5;
                let half_height = self.size[1].abs() * 0.5;
                let horizontal = Vec2::new(position.x - center.x, position.z - center.z);
                horizontal.length_squared() <= radius * radius
                    && position.y >= center.y - half_height
                    && position.y <= center.y + half_height
            }
            ProtectedAreaShape::ChunkSet => {
                let chunk = (position.floor().as_ivec3()).div_euclid(IVec3::splat(CHUNK_SIZE_I32));
                self.chunks
                    .iter()
                    .any(|entry| *entry == [chunk.x, chunk.y, chunk.z])
            }
        }
    }

    pub fn voxel_in_area(&self, voxel: IVec3) -> bool {
        self.point_in_area(voxel.as_vec3() + Vec3::splat(0.5))
    }

    pub fn chunk_intersects_area(&self, chunk: IVec3) -> bool {
        if matches!(self.shape, ProtectedAreaShape::ChunkSet) {
            return self
                .chunks
                .iter()
                .any(|entry| *entry == [chunk.x, chunk.y, chunk.z]);
        }

        let min = (chunk * CHUNK_SIZE_I32).as_vec3();
        let max = min + Vec3::splat(CHUNK_SIZE_F32);
        let chunk_bounds = ProtectedAreaBounds {
            min: [min.x, min.y, min.z],
            max: [max.x, max.y, max.z],
        };

        if !self.bounds.normalized().intersects(chunk_bounds) {
            return false;
        }

        let center = (min + max) * 0.5;
        let corners = [
            min,
            Vec3::new(max.x, min.y, min.z),
            Vec3::new(min.x, max.y, min.z),
            Vec3::new(max.x, max.y, min.z),
            Vec3::new(min.x, min.y, max.z),
            Vec3::new(max.x, min.y, max.z),
            Vec3::new(min.x, max.y, max.z),
            max,
            center,
        ];
        corners.into_iter().any(|point| self.point_in_area(point))
    }

    pub fn effective_rules(&self) -> ProtectedAreaRuleMatrix {
        self.rules.effective_for_kind(self.kind)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtectedEditIntent {
    Mine,
    Place,
    Paint,
    SpawnProps,
    EditWater,
    SaveModify,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedAreaConflict {
    pub left_area_id: String,
    pub right_area_id: String,
    pub priority: i32,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedRuleQueryResult {
    pub position: [i32; 3],
    pub blocked: bool,
    pub area_id: Option<String>,
    pub area_name: Option<String>,
    pub kind: Option<String>,
    pub priority: Option<i32>,
    pub rules: ProtectedAreaRuleMatrix,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedAreaRegistryDto {
    pub schema_version: u32,
    pub areas: Vec<ProtectedArea>,
}

#[derive(Resource, Clone, Debug, Default)]
pub struct ProtectedAreaRegistry {
    areas: BTreeMap<ProtectedAreaId, ProtectedArea>,
}

impl ProtectedAreaRegistry {
    pub fn areas(&self) -> impl Iterator<Item = &ProtectedArea> {
        self.areas.values()
    }

    pub fn area_count(&self) -> usize {
        self.areas.len()
    }

    pub fn get(&self, id: &str) -> Option<&ProtectedArea> {
        self.areas.get(&ProtectedAreaId(id.to_string()))
    }

    pub fn upsert(&mut self, mut area: ProtectedArea) -> Result<ProtectedArea, String> {
        validate_protected_area(&area)?;
        area.bounds = area.bounds.normalized();
        area.schema_version = WORLD_RULES_SCHEMA_VERSION;
        self.areas.insert(area.id.clone(), area.clone());
        Ok(area)
    }

    pub fn update(
        &mut self,
        id: &str,
        patch: ProtectedAreaPatch,
        allow_locked_override: bool,
    ) -> Result<ProtectedArea, String> {
        let Some(existing) = self.get(id).cloned() else {
            return Err(format!("Protected area '{id}' does not exist."));
        };
        if existing.locked && !allow_locked_override {
            return Err(format!("Protected area '{id}' is locked."));
        }

        let mut next = existing;
        patch.apply_to(&mut next);
        self.upsert(next)
    }

    pub fn delete(&mut self, id: &str, allow_locked_override: bool) -> Result<bool, String> {
        let Some(existing) = self.get(id) else {
            return Ok(false);
        };
        if existing.locked && !allow_locked_override {
            return Err(format!("Protected area '{id}' is locked."));
        }
        Ok(self
            .areas
            .remove(&ProtectedAreaId(id.to_string()))
            .is_some())
    }

    pub fn point_in_area(&self, position: Vec3) -> bool {
        self.areas.values().any(|area| area.point_in_area(position))
    }

    pub fn voxel_in_area(&self, voxel: IVec3) -> bool {
        self.areas.values().any(|area| area.voxel_in_area(voxel))
    }

    pub fn chunk_intersects_area(&self, chunk: IVec3) -> bool {
        self.areas
            .values()
            .any(|area| area.chunk_intersects_area(chunk))
    }

    pub fn prop_position_blocked(&self, position: Vec3) -> bool {
        self.highest_priority_rule_at_position(position)
            .map(|(_, rules)| !rules.can_spawn_props)
            .unwrap_or(false)
    }

    pub fn water_edit_blocked(&self, voxel: IVec3) -> bool {
        self.highest_priority_rule_at_position(voxel.as_vec3() + Vec3::splat(0.5))
            .map(|(_, rules)| !rules.can_edit_water)
            .unwrap_or(false)
    }

    pub fn edit_blocked(&self, voxel: IVec3, intent: ProtectedEditIntent) -> bool {
        self.highest_priority_rule_at_position(voxel.as_vec3() + Vec3::splat(0.5))
            .map(|(_, rules)| !rules.allows(intent))
            .unwrap_or(false)
    }

    pub fn highest_priority_rule_at_position(
        &self,
        position: Vec3,
    ) -> Option<(&ProtectedArea, ProtectedAreaRuleMatrix)> {
        self.areas
            .values()
            .filter(|area| area.point_in_area(position))
            .max_by_key(|area| (area.priority, area.id.as_str().to_string()))
            .map(|area| (area, area.effective_rules()))
    }

    pub fn query_rules_at_voxel(&self, voxel: IVec3) -> ProtectedRuleQueryResult {
        match self.highest_priority_rule_at_position(voxel.as_vec3() + Vec3::splat(0.5)) {
            Some((area, rules)) => ProtectedRuleQueryResult {
                position: [voxel.x, voxel.y, voxel.z],
                blocked: rules != ProtectedAreaRuleMatrix::ALLOW_ALL,
                area_id: Some(area.id.0.clone()),
                area_name: Some(area.name.clone()),
                kind: Some(area.kind.as_frontend_str().to_string()),
                priority: Some(area.priority),
                rules,
            },
            None => ProtectedRuleQueryResult {
                position: [voxel.x, voxel.y, voxel.z],
                blocked: false,
                area_id: None,
                area_name: None,
                kind: None,
                priority: None,
                rules: ProtectedAreaRuleMatrix::ALLOW_ALL,
            },
        }
    }

    pub fn conflict_detection(&self) -> Vec<ProtectedAreaConflict> {
        detect_conflicts(self.areas.values())
    }

    pub fn conflicts_for_candidate(&self, candidate: &ProtectedArea) -> Vec<ProtectedAreaConflict> {
        let mut areas: Vec<_> = self.areas.values().cloned().collect();
        areas.retain(|area| area.id != candidate.id);
        areas.push(candidate.clone());
        detect_conflicts(areas.iter())
    }

    pub fn to_dto(&self) -> ProtectedAreaRegistryDto {
        ProtectedAreaRegistryDto {
            schema_version: WORLD_RULES_SCHEMA_VERSION,
            areas: self.areas.values().cloned().collect(),
        }
    }

    pub fn replace_from_dto(&mut self, dto: ProtectedAreaRegistryDto) -> Result<(), String> {
        if dto.schema_version != WORLD_RULES_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported world-rules schema version {}.",
                dto.schema_version
            ));
        }
        let mut next = BTreeMap::new();
        for mut area in dto.areas {
            validate_protected_area(&area)?;
            area.bounds = area.bounds.normalized();
            next.insert(area.id.clone(), area);
        }
        self.areas = next;
        Ok(())
    }

    pub fn save_to_path(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let file = File::create(path.as_ref()).map_err(|err| err.to_string())?;
        serde_json::to_writer_pretty(BufWriter::new(file), &self.to_dto())
            .map_err(|err| err.to_string())
    }

    pub fn load_from_path(&mut self, path: impl AsRef<Path>) -> Result<(), String> {
        let file = File::open(path.as_ref()).map_err(|err| err.to_string())?;
        let dto: ProtectedAreaRegistryDto =
            serde_json::from_reader(BufReader::new(file)).map_err(|err| err.to_string())?;
        self.replace_from_dto(dto)
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedAreaPatch {
    pub name: Option<String>,
    pub kind: Option<ProtectedAreaKind>,
    pub shape: Option<ProtectedAreaShape>,
    pub priority: Option<i32>,
    pub locked: Option<bool>,
    pub color: Option<String>,
    pub center: Option<[f32; 3]>,
    pub size: Option<[f32; 3]>,
    pub bounds: Option<ProtectedAreaBounds>,
    pub rules: Option<ProtectedAreaRuleMatrix>,
    pub chunks: Option<Vec<[i32; 3]>>,
    pub debug_label: Option<Option<String>>,
}

impl ProtectedAreaPatch {
    fn apply_to(self, area: &mut ProtectedArea) {
        if let Some(value) = self.name {
            area.name = value;
        }
        if let Some(value) = self.kind {
            area.kind = value;
        }
        if let Some(value) = self.shape {
            area.shape = value;
        }
        if let Some(value) = self.priority {
            area.priority = value;
        }
        if let Some(value) = self.locked {
            area.locked = value;
        }
        if let Some(value) = self.color {
            area.color = value;
        }
        if let Some(value) = self.center {
            area.center = value;
        }
        if let Some(value) = self.size {
            area.size = value;
        }
        if let Some(value) = self.bounds {
            area.bounds = value;
        }
        if let Some(value) = self.rules {
            area.rules = value;
        }
        if let Some(value) = self.chunks {
            area.chunks = value;
        }
        if let Some(value) = self.debug_label {
            area.debug_label = value;
        }
    }
}

pub fn validate_protected_area(area: &ProtectedArea) -> Result<(), String> {
    if area.id.as_str().trim().is_empty() {
        return Err("Protected area id is required.".to_string());
    }
    if area.name.trim().is_empty() {
        return Err("Protected area name is required.".to_string());
    }
    if area.schema_version != WORLD_RULES_SCHEMA_VERSION {
        return Err(format!(
            "Protected area schema version {} is unsupported.",
            area.schema_version
        ));
    }
    if area
        .size
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0)
    {
        return Err("Protected area size values must be finite and non-negative.".to_string());
    }
    if area.center.iter().any(|value| !value.is_finite())
        || area.bounds.min.iter().any(|value| !value.is_finite())
        || area.bounds.max.iter().any(|value| !value.is_finite())
    {
        return Err("Protected area coordinates must be finite.".to_string());
    }
    if matches!(area.shape, ProtectedAreaShape::ChunkSet) && area.chunks.is_empty() {
        return Err("Chunk-set protected areas require at least one chunk.".to_string());
    }
    Ok(())
}

fn detect_conflicts<'a>(
    areas: impl IntoIterator<Item = &'a ProtectedArea>,
) -> Vec<ProtectedAreaConflict> {
    let areas: Vec<_> = areas.into_iter().collect();
    let mut conflicts = Vec::new();
    for (left_index, left) in areas.iter().enumerate() {
        for right in areas.iter().skip(left_index + 1) {
            if left.priority != right.priority || !left.bounds.intersects(right.bounds) {
                continue;
            }
            let left_rules = left.effective_rules();
            let right_rules = right.effective_rules();
            if left_rules != right_rules || left.locked || right.locked {
                conflicts.push(ProtectedAreaConflict {
                    left_area_id: left.id.0.clone(),
                    right_area_id: right.id.0.clone(),
                    priority: left.priority,
                    message: format!(
                        "Protected areas '{}' and '{}' overlap at priority {}.",
                        left.name, right.name, left.priority
                    ),
                });
            }
        }
    }
    conflicts
}

fn point_in_bounds(position: Vec3, bounds: ProtectedAreaBounds) -> bool {
    let min = bounds.min_vec();
    let max = bounds.max_vec();
    position.x >= min.x
        && position.x <= max.x
        && position.y >= min.y
        && position.y <= max.y
        && position.z >= min.z
        && position.z <= max.z
}

fn array_to_vec3(value: [f32; 3]) -> Vec3 {
    Vec3::new(value[0], value[1], value[2])
}

pub struct WorldRulesPlugin;

impl Plugin for WorldRulesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ProtectedAreaRegistry>();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;
    use crate::voxel::world::{VoxelEditResult, VoxelWorld};

    fn area(
        id: &str,
        kind: ProtectedAreaKind,
        bounds: ProtectedAreaBounds,
        priority: i32,
    ) -> ProtectedArea {
        ProtectedArea {
            id: ProtectedAreaId(id.to_string()),
            name: id.to_string(),
            kind,
            shape: ProtectedAreaShape::Box,
            priority,
            locked: false,
            color: "#22d3ee".to_string(),
            center: [4.0, 4.0, 4.0],
            size: [8.0, 8.0, 8.0],
            bounds,
            rules: ProtectedAreaRuleMatrix::ALLOW_ALL,
            chunks: Vec::new(),
            schema_version: WORLD_RULES_SCHEMA_VERSION,
            debug_label: None,
        }
    }

    fn test_world() -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        world
    }

    #[test]
    fn voxel_inside_unbreakable_area_cannot_be_mined() {
        let mut world = test_world();
        assert_eq!(
            world.set_voxel(IVec3::new(4, 4, 4), VoxelType::Rock),
            VoxelEditResult::Applied
        );
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(area(
                "unbreakable",
                ProtectedAreaKind::Unbreakable,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                1,
            ))
            .unwrap();

        assert_eq!(
            world.set_voxel_with_rules(
                IVec3::new(4, 4, 4),
                VoxelType::Air,
                ProtectedEditIntent::Mine,
                Some(&registry),
            ),
            VoxelEditResult::RejectedProtectedArea,
        );
        assert_eq!(world.get_voxel(IVec3::new(4, 4, 4)), Some(VoxelType::Rock));
    }

    #[test]
    fn voxel_outside_area_can_be_mined() {
        let mut world = test_world();
        assert_eq!(
            world.set_voxel(IVec3::new(12, 4, 12), VoxelType::Rock),
            VoxelEditResult::Applied
        );
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(area(
                "unbreakable",
                ProtectedAreaKind::Unbreakable,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                1,
            ))
            .unwrap();

        assert_eq!(
            world.set_voxel_with_rules(
                IVec3::new(12, 4, 12),
                VoxelType::Air,
                ProtectedEditIntent::Mine,
                Some(&registry),
            ),
            VoxelEditResult::Applied,
        );
    }

    #[test]
    fn no_build_area_blocks_placement() {
        let mut world = test_world();
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(area(
                "no-build",
                ProtectedAreaKind::NoBuild,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                1,
            ))
            .unwrap();

        assert_eq!(
            world.set_voxel_with_rules(
                IVec3::new(4, 4, 4),
                VoxelType::Rock,
                ProtectedEditIntent::Place,
                Some(&registry),
            ),
            VoxelEditResult::RejectedProtectedArea,
        );
        assert_eq!(world.get_voxel(IVec3::new(4, 4, 4)), Some(VoxelType::Air));
    }

    #[test]
    fn water_edit_rule_blocks_replacing_water() {
        let mut world = test_world();
        assert_eq!(
            world.set_voxel(IVec3::new(4, 4, 4), VoxelType::Water),
            VoxelEditResult::Applied
        );
        let mut registry = ProtectedAreaRegistry::default();
        let mut protected = area(
            "no-water",
            ProtectedAreaKind::Custom,
            ProtectedAreaBounds {
                min: [0.0, 0.0, 0.0],
                max: [8.0, 8.0, 8.0],
            },
            1,
        );
        protected.rules = ProtectedAreaRuleMatrix {
            can_edit_water: false,
            ..ProtectedAreaRuleMatrix::ALLOW_ALL
        };
        registry.upsert(protected).unwrap();

        assert_eq!(
            world.set_voxel_with_rules(
                IVec3::new(4, 4, 4),
                VoxelType::Rock,
                ProtectedEditIntent::Place,
                Some(&registry),
            ),
            VoxelEditResult::RejectedProtectedArea,
        );
        assert_eq!(world.get_voxel(IVec3::new(4, 4, 4)), Some(VoxelType::Water));
    }

    #[test]
    fn no_props_area_blocks_prop_positions() {
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(area(
                "no-props",
                ProtectedAreaKind::NoProps,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                1,
            ))
            .unwrap();

        assert!(registry.prop_position_blocked(Vec3::new(1.0, 1.0, 1.0)));
        assert!(!registry.prop_position_blocked(Vec3::new(20.0, 1.0, 1.0)));
    }

    #[test]
    fn priority_resolves_overlapping_areas() {
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(area(
                "low-no-dig",
                ProtectedAreaKind::NoDig,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                1,
            ))
            .unwrap();
        registry
            .upsert(area(
                "high-custom",
                ProtectedAreaKind::Custom,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                2,
            ))
            .unwrap();

        let (_, rules) = registry
            .highest_priority_rule_at_position(Vec3::new(1.0, 1.0, 1.0))
            .unwrap();
        assert!(rules.can_mine);
    }

    #[test]
    fn locked_area_requires_override_for_update_and_delete() {
        let mut registry = ProtectedAreaRegistry::default();
        let mut protected = area(
            "locked",
            ProtectedAreaKind::NoDig,
            ProtectedAreaBounds {
                min: [0.0, 0.0, 0.0],
                max: [8.0, 8.0, 8.0],
            },
            1,
        );
        protected.locked = true;
        registry.upsert(protected).unwrap();

        assert!(
            registry
                .update("locked", ProtectedAreaPatch::default(), false)
                .is_err()
        );
        assert!(registry.delete("locked", false).is_err());
        assert!(registry.delete("locked", true).unwrap());
    }

    #[test]
    fn serialization_roundtrip_works() {
        let mut registry = ProtectedAreaRegistry::default();
        registry
            .upsert(area(
                "save-me",
                ProtectedAreaKind::SpawnProtection,
                ProtectedAreaBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [8.0, 8.0, 8.0],
                },
                1,
            ))
            .unwrap();

        let json = serde_json::to_string(&registry.to_dto()).unwrap();
        let dto: ProtectedAreaRegistryDto = serde_json::from_str(&json).unwrap();
        let mut loaded = ProtectedAreaRegistry::default();
        loaded.replace_from_dto(dto).unwrap();

        assert_eq!(loaded.area_count(), 1);
        assert!(loaded.voxel_in_area(IVec3::new(1, 1, 1)));
    }
}
