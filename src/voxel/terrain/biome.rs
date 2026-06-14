use crate::constants::{TERRAIN_BIOME_FREQUENCY, TERRAIN_CAVE_FREQUENCY};
use bevy::prelude::Resource;

use crate::content::ContentRegistry;
use crate::content::errors::ContentValidationError;
use crate::voxel::terrain::water::ShorelineKind;
use crate::voxel::types::VoxelType;

use super::{NoiseGenerator, TerrainGenerator};

// Biome Types
// =============================================================================

/// Biome type enumeration for terrain variation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Biome {
    /// Normal terrain with grass and soil.
    Grassland,
    /// Sandy desert or beach areas.
    Sandy,
    /// Rocky mountain outcrops.
    Rocky,
    /// Clay deposit areas.
    Clay,
}

impl Biome {
    pub const COUNT: usize = 4;

    /// Returns the biome ID for compatibility with existing code.
    pub fn id(&self) -> u8 {
        match self {
            Biome::Grassland => 0,
            Biome::Sandy => 1,
            Biome::Rocky => 2,
            Biome::Clay => 3,
        }
    }

    /// Creates a biome from its numeric ID.
    pub fn from_id(id: u8) -> Self {
        match id {
            1 => Biome::Sandy,
            2 => Biome::Rocky,
            3 => Biome::Clay,
            _ => Biome::Grassland,
        }
    }
}

pub const BIOME_DEPTH_BANDS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BiomeMaterialBands {
    normal: [VoxelType; BIOME_DEPTH_BANDS],
    shoreline: [VoxelType; BIOME_DEPTH_BANDS],
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct BiomeSelectionRule {
    biome: Biome,
    priority: u8,
    biome_noise_min: Option<f32>,
    biome_noise_max: Option<f32>,
    detail_noise_min: Option<f32>,
    detail_noise_max: Option<f32>,
}

impl BiomeSelectionRule {
    fn matches(&self, biome_noise: f32, detail_noise: f32) -> bool {
        self.biome_noise_min
            .is_none_or(|minimum| biome_noise > minimum)
            && self
                .biome_noise_max
                .is_none_or(|maximum| biome_noise < maximum)
            && self
                .detail_noise_min
                .is_none_or(|minimum| detail_noise > minimum)
            && self
                .detail_noise_max
                .is_none_or(|maximum| detail_noise < maximum)
    }
}

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct BiomeTable {
    biomes: [BiomeMaterialBands; Biome::COUNT],
    selection_rules: [BiomeSelectionRule; Biome::COUNT],
}

impl BiomeTable {
    pub fn from_content_registry(
        registry: &ContentRegistry,
    ) -> Result<Self, ContentValidationError> {
        let empty = BiomeMaterialBands {
            normal: [VoxelType::Air; BIOME_DEPTH_BANDS],
            shoreline: [VoxelType::Air; BIOME_DEPTH_BANDS],
        };
        let mut resolved = [None; Biome::COUNT];
        let mut selection_rules = [None; Biome::COUNT];
        let mut selection_priorities = [false; 256];
        let mut fallback_count = 0;

        for biome in registry.biomes.values() {
            let index = biome.legacy_biome_id as usize;
            if index >= Biome::COUNT {
                return Err(ContentValidationError::new(
                    "INVALID_LEGACY_BIOME_ID",
                    &format!("biomes.{}.legacy_biome_id", biome.id),
                    &format!(
                        "Legacy biome ID {} is outside 0..{}.",
                        biome.legacy_biome_id,
                        Biome::COUNT
                    ),
                ));
            }
            if resolved[index].is_some() {
                return Err(ContentValidationError::new(
                    "DUPLICATE_LEGACY_BIOME_ID",
                    &format!("biomes.{}.legacy_biome_id", biome.id),
                    &format!("Legacy biome ID {} is duplicated.", biome.legacy_biome_id),
                ));
            }
            validate_selection_bounds(
                &biome.id,
                biome.biome_noise_min,
                biome.biome_noise_max,
                "biome_noise",
            )?;
            validate_selection_bounds(
                &biome.id,
                biome.detail_noise_min,
                biome.detail_noise_max,
                "detail_noise",
            )?;
            if selection_priorities[biome.selection_priority as usize] {
                return Err(ContentValidationError::new(
                    "DUPLICATE_BIOME_SELECTION_PRIORITY",
                    &format!("biomes.{}.selection_priority", biome.id),
                    &format!(
                        "Biome selection priority {} is duplicated.",
                        biome.selection_priority
                    ),
                ));
            }
            selection_priorities[biome.selection_priority as usize] = true;
            let is_fallback = biome.biome_noise_min.is_none()
                && biome.biome_noise_max.is_none()
                && biome.detail_noise_min.is_none()
                && biome.detail_noise_max.is_none();
            if is_fallback {
                fallback_count += 1;
                if biome.selection_priority != 0 {
                    return Err(ContentValidationError::new(
                        "INVALID_BIOME_FALLBACK_PRIORITY",
                        &format!("biomes.{}.selection_priority", biome.id),
                        "The unbounded biome fallback must have selection priority 0.",
                    ));
                }
            } else if biome.selection_priority == 0 {
                return Err(ContentValidationError::new(
                    "INVALID_BIOME_SELECTION_PRIORITY",
                    &format!("biomes.{}.selection_priority", biome.id),
                    "Constrained biome selection rules must have priority greater than 0.",
                ));
            }

            resolved[index] = Some(BiomeMaterialBands {
                normal: resolve_material_bands(
                    registry,
                    &biome.id,
                    "surface_material_ids",
                    &biome.surface_material_ids,
                    "underground_material_ids",
                    &biome.underground_material_ids,
                )?,
                shoreline: resolve_material_bands(
                    registry,
                    &biome.id,
                    "shoreline_surface_material_ids",
                    &biome.shoreline_surface_material_ids,
                    "shoreline_underground_material_ids",
                    &biome.shoreline_underground_material_ids,
                )?,
            });
            selection_rules[index] = Some(BiomeSelectionRule {
                biome: Biome::from_id(biome.legacy_biome_id),
                priority: biome.selection_priority,
                biome_noise_min: biome.biome_noise_min,
                biome_noise_max: biome.biome_noise_max,
                detail_noise_min: biome.detail_noise_min,
                detail_noise_max: biome.detail_noise_max,
            });
        }

        let mut biomes = [empty; Biome::COUNT];
        for (index, bands) in resolved.into_iter().enumerate() {
            biomes[index] = bands.ok_or_else(|| {
                ContentValidationError::new(
                    "MISSING_LEGACY_BIOME_ID",
                    "biomes",
                    &format!("No biome defines legacy biome ID {index}."),
                )
            })?;
        }
        if fallback_count != 1 {
            return Err(ContentValidationError::new(
                "INVALID_BIOME_FALLBACK_COUNT",
                "biomes",
                &format!(
                    "Exactly one unbounded biome fallback is required; found {fallback_count}."
                ),
            ));
        }

        let mut selection_rules = selection_rules.map(|rule| {
            rule.expect("complete legacy biome IDs guarantee complete selection rules")
        });
        selection_rules.sort_unstable_by_key(|rule| std::cmp::Reverse(rule.priority));

        Ok(Self {
            biomes,
            selection_rules,
        })
    }

    #[inline]
    pub fn select(&self, biome_noise: f32, detail_noise: f32) -> Biome {
        self.selection_rules
            .iter()
            .find(|rule| rule.matches(biome_noise, detail_noise))
            .map(|rule| rule.biome)
            .expect("validated biome selection rules must include a fallback")
    }

    #[inline]
    pub fn voxel(&self, biome: Biome, depth: i32, near_water: bool) -> VoxelType {
        let depth = depth.clamp(0, (BIOME_DEPTH_BANDS - 1) as i32) as usize;
        let bands = &self.biomes[biome.id() as usize];
        if near_water {
            bands.shoreline[depth]
        } else {
            bands.normal[depth]
        }
    }
}

fn validate_selection_bounds(
    biome_id: &str,
    minimum: Option<f32>,
    maximum: Option<f32>,
    field: &str,
) -> Result<(), ContentValidationError> {
    if minimum.is_some_and(|value| !value.is_finite())
        || maximum.is_some_and(|value| !value.is_finite())
    {
        return Err(ContentValidationError::new(
            "NON_FINITE_BIOME_SELECTION_BOUND",
            &format!("biomes.{biome_id}.{field}"),
            "Biome selection bounds must be finite.",
        ));
    }
    if minimum.zip(maximum).is_some_and(|(min, max)| min >= max) {
        return Err(ContentValidationError::new(
            "INVALID_BIOME_SELECTION_RANGE",
            &format!("biomes.{biome_id}.{field}"),
            "Biome selection minimum must be less than its maximum.",
        ));
    }
    Ok(())
}

impl Default for BiomeTable {
    fn default() -> Self {
        Self::from_content_registry(&crate::content::defaults::get_default_registry())
            .expect("default content must define a valid biome table")
    }
}

fn resolve_material_bands(
    registry: &ContentRegistry,
    biome_id: &str,
    surface_field: &str,
    surface_ids: &[String],
    underground_field: &str,
    underground_ids: &[String],
) -> Result<[VoxelType; BIOME_DEPTH_BANDS], ContentValidationError> {
    let surface_id = surface_ids.first().ok_or_else(|| {
        ContentValidationError::new(
            "EMPTY_BIOME_MATERIAL_BANDS",
            &format!("biomes.{biome_id}.{surface_field}"),
            "Biome surface material bands cannot be empty.",
        )
    })?;
    if underground_ids.is_empty() {
        return Err(ContentValidationError::new(
            "EMPTY_BIOME_MATERIAL_BANDS",
            &format!("biomes.{biome_id}.{underground_field}"),
            "Biome underground material bands cannot be empty.",
        ));
    }
    if underground_ids.len() >= BIOME_DEPTH_BANDS {
        return Err(ContentValidationError::new(
            "TOO_MANY_BIOME_MATERIAL_BANDS",
            &format!("biomes.{biome_id}.{underground_field}"),
            &format!(
                "At most {} underground material bands are supported.",
                BIOME_DEPTH_BANDS - 1
            ),
        ));
    }

    let surface = resolve_voxel_type(registry, biome_id, surface_field, surface_id)?;
    let mut bands = [surface; BIOME_DEPTH_BANDS];
    for depth in 1..BIOME_DEPTH_BANDS {
        let material_index = (depth - 1).min(underground_ids.len() - 1);
        bands[depth] = resolve_voxel_type(
            registry,
            biome_id,
            underground_field,
            &underground_ids[material_index],
        )?;
    }
    Ok(bands)
}

fn resolve_voxel_type(
    registry: &ContentRegistry,
    biome_id: &str,
    field: &str,
    material_id: &str,
) -> Result<VoxelType, ContentValidationError> {
    let material = registry.materials.get(material_id).ok_or_else(|| {
        ContentValidationError::new(
            "MISSING_MATERIAL_REF",
            &format!("biomes.{biome_id}.{field}"),
            &format!("Biome material '{material_id}' does not exist."),
        )
    })?;
    let legacy_id = material.legacy_material_id.ok_or_else(|| {
        ContentValidationError::new(
            "MISSING_LEGACY_MATERIAL_ID",
            &format!("materials.{material_id}.legacy_material_id"),
            "Biome materials must define a legacy material ID.",
        )
    })?;

    match legacy_id {
        0 => Ok(VoxelType::Air),
        1 => Ok(VoxelType::TopSoil),
        2 => Ok(VoxelType::SubSoil),
        3 => Ok(VoxelType::Rock),
        4 => Ok(VoxelType::Bedrock),
        5 => Ok(VoxelType::Sand),
        6 => Ok(VoxelType::Clay),
        7 => Ok(VoxelType::Water),
        8 => Ok(VoxelType::Wood),
        9 => Ok(VoxelType::Leaves),
        10 => Ok(VoxelType::DungeonWall),
        11 => Ok(VoxelType::DungeonFloor),
        _ => Err(ContentValidationError::new(
            "INVALID_VOXEL_TYPE_DISCRIMINANT",
            &format!("materials.{material_id}.legacy_material_id"),
            &format!("Legacy material ID {legacy_id} is not a valid VoxelType."),
        )),
    }
}

impl<N: NoiseGenerator> TerrainGenerator<N> {
    pub fn get_biome(&self, world_x: i32, world_z: i32) -> Biome {
        if let Some(profile) = self.shoreline_profile(world_x, world_z) {
            return match profile.kind {
                ShorelineKind::Beach => Biome::Sandy,
                ShorelineKind::Cliff => Biome::Rocky,
            };
        }

        let x = world_x as f32;
        let z = world_z as f32;

        let biome_noise =
            self.noise
                .fbm_2d(x * TERRAIN_BIOME_FREQUENCY, z * TERRAIN_BIOME_FREQUENCY, 2);
        let detail_noise =
            self.noise
                .fbm_2d(x * TERRAIN_CAVE_FREQUENCY, z * TERRAIN_CAVE_FREQUENCY, 2);

        self.biome_table.select(biome_noise, detail_noise)
    }

    /// Determines the voxel type based on biome, depth, and water proximity.
    pub(crate) fn get_biome_voxel(&self, biome: Biome, depth: i32, near_water: bool) -> VoxelType {
        self.biome_table.voxel(biome, depth, near_water)
    }
}
