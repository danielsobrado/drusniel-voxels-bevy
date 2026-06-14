use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

use super::ids::is_valid_content_id;
use super::registry::ContentRegistry;
use super::types::ProtectedAreaShapeContent;
use crate::voxel::types::VoxelType;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentIssueSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentValidationIssue {
    pub severity: ContentIssueSeverity,
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Resource, Clone, Debug, Default, Serialize, Deserialize)]
pub struct ContentValidationReport {
    pub errors: Vec<ContentValidationIssue>,
    pub warnings: Vec<ContentValidationIssue>,
}

impl ContentValidationReport {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }
}

const BANNED_TERMS: &[&str] = &[
    "claudecraft",
    "wow",
    "paladin",
    "warrior",
    "quest-giver",
    "murloc",
    "gravecaller",
    "eastbrook",
];

pub fn validate_content_registry(registry: &ContentRegistry) -> ContentValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    // Helper to add issues
    let mut add_issue = |severity: ContentIssueSeverity, code: &str, path: &str, message: &str| {
        let issue = ContentValidationIssue {
            severity,
            code: code.to_string(),
            path: path.to_string(),
            message: message.to_string(),
        };
        match severity {
            ContentIssueSeverity::Error => errors.push(issue),
            ContentIssueSeverity::Warning => warnings.push(issue),
        }
    };

    // Helper to parse snap groups
    let parse_snap_group = |s: &str| -> Option<&str> {
        let normalized = s.to_lowercase();
        match normalized.as_str() {
            "floor-edge" | "flooredge" | "floor_edge" => Some("floor-edge"),
            "wall-bottom" | "wallbottom" | "wall_bottom" => Some("wall-bottom"),
            "wall-top" | "walltop" | "wall_top" => Some("wall-top"),
            "wall-side" | "wallside" | "wall_side" => Some("wall-side"),
            "roof-edge" | "roofedge" | "roof_edge" => Some("roof-edge"),
            "generic" => Some("generic"),
            _ => None,
        }
    };

    // Helper to parse voxel type
    let parse_voxel_type = |s: &str| -> Option<VoxelType> {
        match s.to_lowercase().as_str() {
            "air" => Some(VoxelType::Air),
            "topsoil" | "top-soil" => Some(VoxelType::TopSoil),
            "subsoil" | "sub-soil" => Some(VoxelType::SubSoil),
            "rock" => Some(VoxelType::Rock),
            "bedrock" => Some(VoxelType::Bedrock),
            "sand" => Some(VoxelType::Sand),
            "clay" => Some(VoxelType::Clay),
            "water" => Some(VoxelType::Water),
            "wood" => Some(VoxelType::Wood),
            "leaves" => Some(VoxelType::Leaves),
            "dungeonwall" | "dungeon-wall" => Some(VoxelType::DungeonWall),
            "dungeonfloor" | "dungeon-floor" => Some(VoxelType::DungeonFloor),
            _ => None,
        }
    };

    // 5. Banned MMO terms scanner
    let check_banned_terms =
        |val: &str,
         path: &str,
         add_issue: &mut dyn FnMut(ContentIssueSeverity, &str, &str, &str)| {
            let lower = val.to_lowercase();
            for &term in BANNED_TERMS {
                if lower.contains(term) {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "BANNED_TERM",
                        path,
                        &format!(
                            "Value contains banned MMO/World of Claudecraft term: {}",
                            term
                        ),
                    );
                }
            }
        };

    // Validate IDs format and banned terms
    // Materials
    let mut material_legacy_ids = HashSet::new();
    for (id, mat) in &registry.materials {
        let path = format!("materials.{}", id);
        // Rule 1 & 3: Kebab-case & Non-empty IDs
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Material ID must be lowercase kebab-case and non-empty.",
            );
        }
        if id != &mat.id {
            add_issue(
                ContentIssueSeverity::Error,
                "ID_MISMATCH",
                &path,
                "Registry key must match material ID.",
            );
        }
        check_banned_terms(&mat.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&mat.name, &format!("{}.name", path), &mut add_issue);

        // Rule 4: Unique legacy IDs
        if let Some(legacy_id) = mat.legacy_material_id {
            if !material_legacy_ids.insert(legacy_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "DUPLICATE_LEGACY_ID",
                    &path,
                    &format!("Duplicate legacy material ID: {}", legacy_id),
                );
            }
            // Rule 9: Valid current VoxelType discriminant
            if legacy_id > 11 {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_VOXEL_TYPE_DISCRIMINANT",
                    &path,
                    &format!(
                        "Legacy ID {} is not a valid VoxelType discriminant (0..=11).",
                        legacy_id
                    ),
                );
            }
        }

        // Rule 9: Valid default voxel type
        if let Some(ref voxel_str) = mat.default_voxel {
            if parse_voxel_type(voxel_str).is_none() {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_DEFAULT_VOXEL",
                    &path,
                    &format!("Default voxel '{}' is not a valid VoxelType.", voxel_str),
                );
            }
        }

        // Rule 6: material_type_id resolves
        if !registry.material_types.contains_key(&mat.material_type_id) {
            add_issue(
                ContentIssueSeverity::Error,
                "MISSING_MATERIAL_TYPE_REF",
                &format!("{}.material_type_id", path),
                &format!("Material type '{}' does not exist.", mat.material_type_id),
            );
        }

        // Rule 10: air must be id 0 if present
        if mat.id == "air" && mat.legacy_material_id != Some(0) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_AIR_ID",
                &path,
                "Air material must have legacy ID 0.",
            );
        }

        // Rule 11: water must be liquid and transparent
        if mat.id == "water" && (!mat.liquid || !mat.transparent) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_WATER_PROPERTIES",
                &path,
                "Water material must be transparent and liquid.",
            );
        }

        // Rule 12: bedrock must not be diggable
        if mat.id == "bedrock" && mat.diggable {
            add_issue(
                ContentIssueSeverity::Error,
                "BEDROCK_IS_DIGGABLE",
                &path,
                "Bedrock must not be diggable.",
            );
        }

        // Rule 14: f32 values are finite
        if !mat.metallic.is_finite()
            || !mat.smooth.is_finite()
            || !mat.emissive.is_finite()
            || !mat.surface_transmission.is_finite()
            || !mat.phase.is_finite()
            || !mat.strength.is_finite()
        {
            add_issue(
                ContentIssueSeverity::Error,
                "NON_FINITE_FLOAT",
                &path,
                "Metallic, smooth, emissive, transmission, phase, and strength floats must be finite.",
            );
        }

        // Rule 15: index_of_refraction > 0
        if mat.index_of_refraction <= 0.0 || !mat.index_of_refraction.is_finite() {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_REFRACTION",
                &path,
                "Index of refraction must be > 0 and finite.",
            );
        }

        // Rule 16: liquid materials should not be solid
        if mat.liquid && mat.solid {
            add_issue(
                ContentIssueSeverity::Error,
                "LIQUID_SOLID_CONFLICT",
                &path,
                "Material cannot be both liquid and solid.",
            );
        }
    }

    // Material Types
    for (id, mt) in &registry.material_types {
        let path = format!("material_types.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Material type ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&mt.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&mt.name, &format!("{}.name", path), &mut add_issue);

        // Rule 7: Every material referenced by a material type exists
        for mat_id in &mt.material_ids {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!("References missing material: {}", mat_id),
                );
            }
        }
    }

    // Palettes
    for (id, pal) in &registry.palettes {
        let path = format!("palettes.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Palette ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&pal.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&pal.name, &format!("{}.name", path), &mut add_issue);

        // Rule 8: Every material referenced by a palette exists
        for mat_id in &pal.material_ids {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!("Palette references missing material: {}", mat_id),
                );
            }
        }
    }

    // Texture Slots
    let mut texture_slot_indices = HashMap::new();
    for (id, slot) in &registry.texture_slots {
        let path = format!("texture_slots.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Texture slot ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&slot.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&slot.name, &format!("{}.name", path), &mut add_issue);

        // Rule 19: Unique slot index unless alias
        if !slot.alias.unwrap_or(false) {
            if let Some(existing_id) = texture_slot_indices.insert(slot.slot_index, id.clone()) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "DUPLICATE_SLOT_INDEX",
                    &path,
                    &format!(
                        "Texture slot index {} is already used by slot: {}",
                        slot.slot_index, existing_id
                    ),
                );
            }
        }

        // Rule 20: Slot material resolves if present
        if let Some(ref mat_id) = slot.material_id {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!("Slot references missing material: {}", mat_id),
                );
            }
        }
    }

    // Atlas Mappings
    for (id, mapping) in &registry.atlas_mappings {
        let path = format!("atlas_mappings.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Atlas mapping ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&mapping.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&mapping.name, &format!("{}.name", path), &mut add_issue);

        // Rule 17: Atlas mapping material resolves
        if !registry.materials.contains_key(&mapping.material_id) {
            add_issue(
                ContentIssueSeverity::Error,
                "MISSING_MATERIAL_REF",
                &path,
                &format!(
                    "Mapping references missing material: {}",
                    mapping.material_id
                ),
            );
        }

        // Rule 18: Tile indices within ATLAS_COLUMNS * ATLAS_ROWS (16)
        let max_tile =
            crate::shared::constants::ATLAS_COLUMNS * crate::shared::constants::ATLAS_ROWS;
        if mapping.top >= max_tile || mapping.side >= max_tile || mapping.bottom >= max_tile {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_TILE_INDEX",
                &path,
                &format!(
                    "Tile index must be less than {} (ATLAS_COLUMNS * ATLAS_ROWS).",
                    max_tile
                ),
            );
        }
    }

    // Biomes
    let mut biome_legacy_ids = HashSet::new();
    let mut biome_selection_priorities = HashSet::new();
    let mut biome_fallback_count = 0;
    for (id, biome) in &registry.biomes {
        let path = format!("biomes.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Biome ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&biome.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&biome.name, &format!("{}.name", path), &mut add_issue);

        if biome.legacy_biome_id as usize >= crate::voxel::terrain::Biome::COUNT {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_LEGACY_BIOME_ID",
                &format!("{}.legacy_biome_id", path),
                &format!(
                    "Legacy biome ID {} must be in 0..{}.",
                    biome.legacy_biome_id,
                    crate::voxel::terrain::Biome::COUNT
                ),
            );
        } else if !biome_legacy_ids.insert(biome.legacy_biome_id) {
            add_issue(
                ContentIssueSeverity::Error,
                "DUPLICATE_LEGACY_BIOME_ID",
                &format!("{}.legacy_biome_id", path),
                &format!("Duplicate legacy biome ID: {}", biome.legacy_biome_id),
            );
        }

        if !biome_selection_priorities.insert(biome.selection_priority) {
            add_issue(
                ContentIssueSeverity::Error,
                "DUPLICATE_BIOME_SELECTION_PRIORITY",
                &format!("{}.selection_priority", path),
                &format!(
                    "Duplicate biome selection priority: {}",
                    biome.selection_priority
                ),
            );
        }
        let selection_bounds = [
            ("biome_noise", biome.biome_noise_min, biome.biome_noise_max),
            (
                "detail_noise",
                biome.detail_noise_min,
                biome.detail_noise_max,
            ),
        ];
        for (field, minimum, maximum) in selection_bounds {
            let field_path = format!("{}.{}", path, field);
            if minimum.is_some_and(|value| !value.is_finite())
                || maximum.is_some_and(|value| !value.is_finite())
            {
                add_issue(
                    ContentIssueSeverity::Error,
                    "NON_FINITE_BIOME_SELECTION_BOUND",
                    &field_path,
                    "Biome selection bounds must be finite.",
                );
            }
            if minimum.zip(maximum).is_some_and(|(min, max)| min >= max) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_BIOME_SELECTION_RANGE",
                    &field_path,
                    "Biome selection minimum must be less than its maximum.",
                );
            }
        }
        let is_fallback = biome.biome_noise_min.is_none()
            && biome.biome_noise_max.is_none()
            && biome.detail_noise_min.is_none()
            && biome.detail_noise_max.is_none();
        if is_fallback {
            biome_fallback_count += 1;
            if biome.selection_priority != 0 {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_BIOME_FALLBACK_PRIORITY",
                    &format!("{}.selection_priority", path),
                    "The unbounded biome fallback must have selection priority 0.",
                );
            }
        } else if biome.selection_priority == 0 {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_BIOME_SELECTION_PRIORITY",
                &format!("{}.selection_priority", path),
                "Constrained biome selection rules must have priority greater than 0.",
            );
        }

        // Rule 21: default_material_id resolves
        if !registry.materials.contains_key(&biome.default_material_id) {
            add_issue(
                ContentIssueSeverity::Error,
                "MISSING_MATERIAL_REF",
                &path,
                &format!(
                    "Biome references missing default material: {}",
                    biome.default_material_id
                ),
            );
        }

        // Rule 22: water_material_id resolves and points to liquid/transparent material if present
        if let Some(ref water_id) = biome.water_material_id {
            if let Some(water_mat) = registry.materials.get(water_id) {
                if !water_mat.liquid || !water_mat.transparent {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "INVALID_WATER_MATERIAL",
                        &path,
                        &format!(
                            "Biome water material '{}' must be transparent and liquid.",
                            water_id
                        ),
                    );
                }
            } else {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!("Biome references missing water material: {}", water_id),
                );
            }
        }

        let material_bands = [
            ("surface_material_ids", &biome.surface_material_ids, false),
            (
                "underground_material_ids",
                &biome.underground_material_ids,
                true,
            ),
            (
                "shoreline_surface_material_ids",
                &biome.shoreline_surface_material_ids,
                false,
            ),
            (
                "shoreline_underground_material_ids",
                &biome.shoreline_underground_material_ids,
                true,
            ),
        ];
        for (field, material_ids, underground) in material_bands {
            let field_path = format!("{}.{}", path, field);
            if material_ids.is_empty() {
                add_issue(
                    ContentIssueSeverity::Error,
                    "EMPTY_BIOME_MATERIAL_BANDS",
                    &field_path,
                    "Biome material bands cannot be empty.",
                );
            }
            if underground && material_ids.len() >= crate::voxel::terrain::BIOME_DEPTH_BANDS {
                add_issue(
                    ContentIssueSeverity::Error,
                    "TOO_MANY_BIOME_MATERIAL_BANDS",
                    &field_path,
                    &format!(
                        "At most {} underground bands are supported.",
                        crate::voxel::terrain::BIOME_DEPTH_BANDS - 1
                    ),
                );
            }

            for mat_id in material_ids {
                let Some(material) = registry.materials.get(mat_id) else {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "MISSING_MATERIAL_REF",
                        &field_path,
                        &format!("Biome material '{}' does not exist.", mat_id),
                    );
                    continue;
                };
                match material.legacy_material_id {
                    None => add_issue(
                        ContentIssueSeverity::Error,
                        "MISSING_LEGACY_MATERIAL_ID",
                        &field_path,
                        &format!("Biome material '{}' lacks a legacy material ID.", mat_id),
                    ),
                    Some(legacy_id) if legacy_id > 11 => add_issue(
                        ContentIssueSeverity::Error,
                        "INVALID_VOXEL_TYPE_DISCRIMINANT",
                        &field_path,
                        &format!(
                            "Biome material '{}' has invalid legacy material ID {}.",
                            mat_id, legacy_id
                        ),
                    ),
                    Some(_) => {}
                }
            }
        }
    }

    for legacy_id in 0..crate::voxel::terrain::Biome::COUNT as u8 {
        if !biome_legacy_ids.contains(&legacy_id) {
            add_issue(
                ContentIssueSeverity::Error,
                "MISSING_LEGACY_BIOME_ID",
                "biomes",
                &format!("No biome defines legacy biome ID {}.", legacy_id),
            );
        }
    }
    if biome_fallback_count != 1 {
        add_issue(
            ContentIssueSeverity::Error,
            "INVALID_BIOME_FALLBACK_COUNT",
            "biomes",
            &format!(
                "Exactly one unbounded biome fallback is required; found {}.",
                biome_fallback_count
            ),
        );
    }

    // Props
    for (id, prop) in &registry.props {
        let path = format!("props.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Prop ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&prop.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&prop.name, &format!("{}.name", path), &mut add_issue);

        // Rule 27: asset_path must not be empty if present
        if let Some(ref asset_path) = prop.asset_path {
            if asset_path.trim().is_empty() {
                add_issue(
                    ContentIssueSeverity::Error,
                    "EMPTY_ASSET_PATH",
                    &path,
                    "Prop asset_path cannot be empty.",
                );
            }
        }

        // Rule 28: spawn_weight >= 0
        if prop.spawn_weight < 0.0 || !prop.spawn_weight.is_finite() {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_SPAWN_WEIGHT",
                &path,
                "Prop spawn_weight must be a finite non-negative number.",
            );
        }

        // Rule 29: footprint dimensions are positive finite
        if prop.footprint.iter().any(|&d| d <= 0.0 || !d.is_finite()) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_FOOTPRINT",
                &path,
                "Prop footprint dimensions must be positive finite numbers.",
            );
        }

        // Rule 30: biome_ids resolve
        for biome_id in &prop.biome_ids {
            if !registry.biomes.contains_key(biome_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_BIOME_REF",
                    &path,
                    &format!("Prop references missing biome: {}", biome_id),
                );
            }
        }

        // Rule 31: can_spawn_on_material_ids resolve
        for mat_id in &prop.can_spawn_on_material_ids {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!("Prop references missing spawn material: {}", mat_id),
                );
            }
        }
    }

    // Building Pieces
    for (id, piece) in &registry.building_pieces {
        let path = format!("building_pieces.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Building piece ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&piece.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&piece.name, &format!("{}.name", path), &mut add_issue);

        // Rule 32: dimensions are positive finite
        if piece.dimensions.iter().any(|&d| d <= 0.0 || !d.is_finite()) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_DIMENSIONS",
                &path,
                "Building piece dimensions must be positive finite numbers.",
            );
        }

        // Rule 33: material_type resolves (check valid parsed building material type)
        let parsed_mat = match piece.material_type.to_lowercase().as_str() {
            "wood" | "woodplank" | "wood_plank" => Some(()),
            "stone" | "stonebrick" | "stone_brick" => Some(()),
            "metal" | "metalplate" | "metal_plate" => Some(()),
            "thatch" => Some(()),
            _ => None,
        };
        if parsed_mat.is_none() {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_MATERIAL_TYPE",
                &path,
                &format!(
                    "Building piece has invalid material type: {}",
                    piece.material_type
                ),
            );
        }

        if let Some(profile) = &piece.support_profile {
            let profile_path = format!("{}.support_profile", path);
            if !profile.max_support.is_finite() || profile.max_support <= 0.0 {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_MAX_SUPPORT",
                    &profile_path,
                    "Support max_support must be a positive finite number.",
                );
            }
            if !profile.decay_per_hop.is_finite() || profile.decay_per_hop < 0.0 {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_SUPPORT_DECAY",
                    &profile_path,
                    "Support decay_per_hop must be a non-negative finite number.",
                );
            }
            if !matches!(
                profile.class.to_ascii_lowercase().as_str(),
                "wood" | "stone" | "ground"
            ) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "INVALID_SUPPORT_CLASS",
                    &profile_path,
                    "Support class must be wood, stone, or ground.",
                );
            }
        }

        // Rule 34: material_id resolves if present
        if let Some(ref mat_id) = piece.material_id {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!("Building piece references missing material: {}", mat_id),
                );
            }
        }

        // Rule 35: mesh_path must not be empty if present
        if let Some(ref mesh_path) = piece.mesh_path {
            if mesh_path.trim().is_empty() {
                add_issue(
                    ContentIssueSeverity::Error,
                    "EMPTY_MESH_PATH",
                    &path,
                    "Building piece mesh_path cannot be empty.",
                );
            }
        }

        // Rule 41: every building piece has at least one snap point unless category is prop
        if piece.category != "prop" && piece.snap_points.is_empty() {
            add_issue(
                ContentIssueSeverity::Error,
                "MISSING_SNAP_POINTS",
                &path,
                "Building piece (non-prop) must have at least one snap point.",
            );
        }

        let mut snap_ids = HashSet::new();
        for (idx, sp) in piece.snap_points.iter().enumerate() {
            let sp_path = format!("{}.snap_points[{}]", path, idx);

            // Rule 36: snap point IDs are unique inside each piece
            if !snap_ids.insert(&sp.id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "DUPLICATE_SNAP_POINT_ID",
                    &sp_path,
                    &format!("Duplicate snap point ID '{}' in piece.", sp.id),
                );
            }

            // Rule 37: snap point directions are normalizable
            let len_sq = sp.direction.iter().map(|&x| x * x).sum::<f32>();
            if len_sq < 1e-6 || !len_sq.is_finite() {
                add_issue(
                    ContentIssueSeverity::Error,
                    "UNNORMALIZABLE_SNAP_DIRECTION",
                    &sp_path,
                    "Snap point direction vector is too close to zero or non-finite.",
                );
            }

            // Rule 38: snap_group is known
            if parse_snap_group(&sp.snap_group).is_none() {
                add_issue(
                    ContentIssueSeverity::Error,
                    "UNKNOWN_SNAP_GROUP",
                    &sp_path,
                    &format!("Unknown snap group: {}", sp.snap_group),
                );
            }

            // Rule 39: compatible_groups use known groups
            for (g_idx, cg) in sp.compatible_groups.iter().enumerate() {
                if parse_snap_group(cg).is_none() {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "UNKNOWN_COMPATIBLE_SNAP_GROUP",
                        &format!("{}.compatible_groups[{}]", sp_path, g_idx),
                        &format!("Unknown compatible group: {}", cg),
                    );
                }
            }

            // Rule 40: compatible_piece_ids resolve if present
            for (p_idx, cp_id) in sp.compatible_piece_ids.iter().enumerate() {
                if !registry.building_pieces.contains_key(cp_id) {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "MISSING_COMPATIBLE_PIECE_REF",
                        &format!("{}.compatible_piece_ids[{}]", sp_path, p_idx),
                        &format!("References missing compatible piece: {}", cp_id),
                    );
                }
            }
        }
    }

    // Rule 42: impossible snap point check
    for piece_a in registry.building_pieces.values() {
        for sp_a in &piece_a.snap_points {
            for comp_b_id in &sp_a.compatible_piece_ids {
                if let Some(piece_b) = registry.building_pieces.get(comp_b_id) {
                    let mut allowed = false;
                    for sp_b in &piece_b.snap_points {
                        if sp_b.compatible_piece_ids.contains(&piece_a.id) {
                            allowed = true;
                            break;
                        }
                        // Or check if their snap groups are compatible
                        let grp_a = parse_snap_group(&sp_a.snap_group);
                        let grp_b = parse_snap_group(&sp_b.snap_group);
                        if let (Some(ga), Some(gb)) = (grp_a, grp_b) {
                            // Convert string groups to SnapGroup enum representation to test compatibility
                            let enum_a = match ga {
                                "floor-edge" => {
                                    Some(crate::gameplay::building::types::SnapGroup::FloorEdge)
                                }
                                "wall-bottom" => {
                                    Some(crate::gameplay::building::types::SnapGroup::WallBottom)
                                }
                                "wall-top" => {
                                    Some(crate::gameplay::building::types::SnapGroup::WallTop)
                                }
                                "wall-side" => {
                                    Some(crate::gameplay::building::types::SnapGroup::WallSide)
                                }
                                "roof-edge" => {
                                    Some(crate::gameplay::building::types::SnapGroup::RoofEdge)
                                }
                                "generic" => {
                                    Some(crate::gameplay::building::types::SnapGroup::Generic)
                                }
                                _ => None,
                            };
                            let enum_b = match gb {
                                "floor-edge" => {
                                    Some(crate::gameplay::building::types::SnapGroup::FloorEdge)
                                }
                                "wall-bottom" => {
                                    Some(crate::gameplay::building::types::SnapGroup::WallBottom)
                                }
                                "wall-top" => {
                                    Some(crate::gameplay::building::types::SnapGroup::WallTop)
                                }
                                "wall-side" => {
                                    Some(crate::gameplay::building::types::SnapGroup::WallSide)
                                }
                                "roof-edge" => {
                                    Some(crate::gameplay::building::types::SnapGroup::RoofEdge)
                                }
                                "generic" => {
                                    Some(crate::gameplay::building::types::SnapGroup::Generic)
                                }
                                _ => None,
                            };
                            if let (Some(ea), Some(eb)) = (enum_a, enum_b) {
                                if ea.is_compatible_with(&eb) {
                                    allowed = true;
                                    break;
                                }
                            }
                        }
                    }
                    if !allowed {
                        add_issue(
                            ContentIssueSeverity::Warning,
                            "ONE_WAY_SNAP_COMPATIBILITY",
                            &format!("building_pieces.{}.snap_points.{}", piece_a.id, sp_a.id),
                            &format!(
                                "Piece '{}' lists '{}' as compatible, but '{}' has no snap point that reciprocates.",
                                piece_a.id, piece_b.id, piece_b.id
                            ),
                        );
                    }
                }
            }
        }
    }

    // Protected Areas
    for (id, area) in &registry.protected_areas {
        let path = format!("protected_areas.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Protected area ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&area.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&area.name, &format!("{}.name", path), &mut add_issue);

        // Rule 43: shape values are finite
        // Rule 44 & 45: Positive values
        match &area.shape {
            ProtectedAreaShapeContent::Box {
                center,
                half_extents,
            } => {
                if center.iter().any(|&c| !c.is_finite())
                    || half_extents.iter().any(|&e| !e.is_finite())
                {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "NON_FINITE_SHAPE",
                        &path,
                        "Protected area box shape center and half extents must be finite.",
                    );
                }
                if half_extents.iter().any(|&e| e <= 0.0) {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "INVALID_HALF_EXTENTS",
                        &path,
                        "Protected area box half extents must be positive.",
                    );
                }
            }
            ProtectedAreaShapeContent::Cylinder {
                center,
                radius,
                height,
            } => {
                if center.iter().any(|&c| !c.is_finite())
                    || !radius.is_finite()
                    || !height.is_finite()
                {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "NON_FINITE_SHAPE",
                        &path,
                        "Protected area cylinder shape center, radius, and height must be finite.",
                    );
                }
                if *radius <= 0.0 || *height <= 0.0 {
                    add_issue(
                        ContentIssueSeverity::Error,
                        "INVALID_CYLINDER_DIMENSIONS",
                        &path,
                        "Protected area cylinder radius and height must be positive.",
                    );
                }
            }
        }

        // Rule 46: material overrides resolve
        for mat_id in &area.material_overrides {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!(
                        "Protected area references missing override material: {}",
                        mat_id
                    ),
                );
            }
        }

        // Rule 47: rule is one of known
        if !matches!(
            area.rule.to_lowercase().as_str(),
            "unbreakable" | "protected" | "no-building" | "no-terrain-edit" | "visual-only"
        ) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_PROTECTION_RULE",
                &path,
                &format!("Unknown protected area rule: {}", area.rule),
            );
        }
    }

    // Objectives
    for (id, obj) in &registry.objectives {
        let path = format!("objectives.{}", id);
        if !is_valid_content_id(id) {
            add_issue(
                ContentIssueSeverity::Error,
                "INVALID_ID_FORMAT",
                &path,
                "Objective ID must be lowercase kebab-case.",
            );
        }
        check_banned_terms(&obj.id, &format!("{}.id", path), &mut add_issue);
        check_banned_terms(&obj.name, &format!("{}.name", path), &mut add_issue);

        // Rule 48: required material/prop/biome references resolve
        for mat_id in &obj.required_material_ids {
            if !registry.materials.contains_key(mat_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_MATERIAL_REF",
                    &path,
                    &format!(
                        "Objective references missing material requirement: {}",
                        mat_id
                    ),
                );
            }
        }
        for prop_id in &obj.required_prop_ids {
            if !registry.props.contains_key(prop_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_PROP_REF",
                    &path,
                    &format!("Objective references missing prop requirement: {}", prop_id),
                );
            }
        }
        for biome_id in &obj.required_biome_ids {
            if !registry.biomes.contains_key(biome_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_BIOME_REF",
                    &path,
                    &format!(
                        "Objective references missing biome requirement: {}",
                        biome_id
                    ),
                );
            }
        }

        // Rule 49: next_objective_ids resolve
        for next_id in &obj.next_objective_ids {
            if !registry.objectives.contains_key(next_id) {
                add_issue(
                    ContentIssueSeverity::Error,
                    "MISSING_OBJECTIVE_REF",
                    &path,
                    &format!("Objective references missing next objective: {}", next_id),
                );
            }
        }
    }

    // Rule 50: Objective self-cycles & direct self-cycle check
    for id in registry.objectives.keys() {
        let mut visited = HashSet::new();
        let mut stack = HashSet::new();
        if has_cycle(id, registry, &mut visited, &mut stack) {
            add_issue(
                ContentIssueSeverity::Error,
                "OBJECTIVE_CYCLE_DETECTED",
                &format!("objectives.{}", id),
                "Direct or indirect self-cycle detected in objective graph.",
            );
        }
    }

    // Rule 51: unreachable objectives warnings
    let mut in_degrees = HashMap::new();
    for obj in registry.objectives.values() {
        in_degrees.entry(obj.id.clone()).or_insert(0);
        for next in &obj.next_objective_ids {
            *in_degrees.entry(next.clone()).or_insert(0) += 1;
        }
    }

    let starts: Vec<String> = in_degrees
        .iter()
        .filter(|&(_, &deg)| deg == 0)
        .map(|(id, _)| id.clone())
        .collect();

    if !starts.is_empty() {
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        for s in &starts {
            visited.insert(s.clone());
            queue.push_back(s.clone());
        }

        while let Some(curr) = queue.pop_front() {
            if let Some(obj) = registry.objectives.get(&curr) {
                for next in &obj.next_objective_ids {
                    if !visited.contains(next) {
                        visited.insert(next.clone());
                        queue.push_back(next.clone());
                    }
                }
            }
        }

        for obj in registry.objectives.values() {
            if !visited.contains(&obj.id) {
                add_issue(
                    ContentIssueSeverity::Warning,
                    "UNREACHABLE_OBJECTIVE",
                    &format!("objectives.{}", obj.id),
                    &format!(
                        "Objective '{}' is unreachable from start objectives (nodes with in-degree 0).",
                        obj.id
                    ),
                );
            }
        }
    }

    ContentValidationReport { errors, warnings }
}

fn has_cycle(
    node: &str,
    registry: &ContentRegistry,
    visited: &mut HashSet<String>,
    stack: &mut HashSet<String>,
) -> bool {
    visited.insert(node.to_string());
    stack.insert(node.to_string());

    if let Some(obj) = registry.objectives.get(node) {
        for next in &obj.next_objective_ids {
            if !visited.contains(next) {
                if has_cycle(next, registry, visited, stack) {
                    return true;
                }
            } else if stack.contains(next) {
                return true;
            }
        }
    }

    stack.remove(node);
    false
}
