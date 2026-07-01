use bevy::prelude::*;
use serde::Deserialize;
use std::collections::HashMap;

use super::persistence::{GroundContactData, PropPlacementData};
use super::placement::{
    PlacementConfig, TerrainAnalyzer, calculate_prop_rotation, quat_to_euler_degrees, seeded_random,
};
use super::{PropDefinition, PropType};
use crate::constants::WATER_LEVEL;
use crate::voxel::terrain::{ClimateSample, TerrainGenerator, ValueNoise};
use crate::voxel::world::VoxelWorld;
use crate::world_rules::ProtectedAreaRegistry;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnderstoryClass {
    Shrub,
    Fern,
    Sapling,
    Flower,
    DeadLog,
    Stump,
}

impl UnderstoryClass {
    pub const ALL: [Self; 6] = [
        Self::Shrub,
        Self::Fern,
        Self::Sapling,
        Self::Flower,
        Self::DeadLog,
        Self::Stump,
    ];

    fn default_asset_ids(self) -> Vec<String> {
        match self {
            Self::Shrub => vec![
                "understory_shrub".to_string(),
                "understory_shrub_flowers".to_string(),
            ],
            Self::Fern => vec!["understory_fern".to_string()],
            Self::Sapling => vec!["understory_sapling".to_string()],
            Self::Flower => vec!["understory_flower".to_string()],
            Self::DeadLog => vec!["understory_dead_log".to_string()],
            Self::Stump => vec!["understory_stump".to_string()],
        }
    }
}

#[derive(Resource, Deserialize, Clone, Debug)]
pub struct UnderstoryConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_seed")]
    pub seed: i32,
    #[serde(default = "default_distance_m")]
    pub distance_m: f32,
    #[serde(default = "default_refresh_distance_m")]
    pub refresh_distance_m: f32,
    #[serde(default = "default_max_new_patches_per_frame")]
    pub max_new_patches_per_frame: u32,
    #[serde(default = "default_max_instances")]
    pub max_instances: u32,
    #[serde(default)]
    pub max_instances_per_chunk: Option<u32>,
    #[serde(default)]
    pub placement: UnderstoryPlacementConfig,
    #[serde(default)]
    pub ecology: UnderstoryEcologyConfig,
    #[serde(default)]
    pub terrain: UnderstoryTerrainConfig,
    #[serde(default)]
    pub classes: UnderstoryClassesConfig,
    #[serde(default)]
    pub render: UnderstoryRenderConfig,
    #[serde(default)]
    pub gpu: UnderstoryGpuConfig,
}

impl Default for UnderstoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            seed: default_seed(),
            distance_m: default_distance_m(),
            refresh_distance_m: default_refresh_distance_m(),
            max_new_patches_per_frame: default_max_new_patches_per_frame(),
            max_instances: default_max_instances(),
            max_instances_per_chunk: None,
            placement: UnderstoryPlacementConfig::default(),
            ecology: UnderstoryEcologyConfig::default(),
            terrain: UnderstoryTerrainConfig::default(),
            classes: UnderstoryClassesConfig::default(),
            render: UnderstoryRenderConfig::default(),
            gpu: UnderstoryGpuConfig::default(),
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryPlacementConfig {
    #[serde(default = "default_spacing_m")]
    pub spacing_m: f32,
    #[serde(default = "default_jitter")]
    pub jitter: f32,
    #[serde(default = "default_slope_min_y")]
    pub slope_min_y: f32,
    #[serde(default = "default_min_height_m")]
    pub min_height_m: f32,
    #[serde(default = "default_max_height_m")]
    pub max_height_m: f32,
    #[serde(default = "default_min_ground_weight")]
    pub min_ground_weight: f32,
    #[serde(default)]
    pub min_tree_influence: f32,
}

impl Default for UnderstoryPlacementConfig {
    fn default() -> Self {
        Self {
            spacing_m: default_spacing_m(),
            jitter: default_jitter(),
            slope_min_y: default_slope_min_y(),
            min_height_m: default_min_height_m(),
            max_height_m: default_max_height_m(),
            min_ground_weight: default_min_ground_weight(),
            min_tree_influence: 0.0,
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryEcologyConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_forest_influence_scale_m")]
    pub forest_influence_scale_m: f32,
    #[serde(default = "default_forest_edge_width_m")]
    pub forest_edge_width_m: f32,
    #[serde(default = "default_clearing_preference")]
    pub clearing_preference: f32,
    #[serde(default = "default_moisture_noise_scale_m")]
    pub moisture_noise_scale_m: f32,
    #[serde(default = "default_moisture_strength")]
    pub moisture_strength: f32,
    #[serde(default = "default_shade_strength")]
    pub shade_strength: f32,
    #[serde(default = "default_density_noise_scale_m")]
    pub density_noise_scale_m: f32,
    #[serde(default = "default_density_noise_strength")]
    pub density_noise_strength: f32,
    #[serde(default = "default_deadfall_old_forest_bias")]
    pub deadfall_old_forest_bias: f32,
}

impl Default for UnderstoryEcologyConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            forest_influence_scale_m: default_forest_influence_scale_m(),
            forest_edge_width_m: default_forest_edge_width_m(),
            clearing_preference: default_clearing_preference(),
            moisture_noise_scale_m: default_moisture_noise_scale_m(),
            moisture_strength: default_moisture_strength(),
            shade_strength: default_shade_strength(),
            density_noise_scale_m: default_density_noise_scale_m(),
            density_noise_strength: default_density_noise_strength(),
            deadfall_old_forest_bias: default_deadfall_old_forest_bias(),
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryTerrainConfig {
    #[serde(default = "default_terrain_grass")]
    pub grass: UnderstoryTerrainWeights,
    #[serde(default = "default_terrain_rock")]
    pub rock: UnderstoryTerrainWeights,
    #[serde(default = "default_terrain_sand")]
    pub sand: UnderstoryTerrainWeights,
    #[serde(default = "default_terrain_snow")]
    pub snow: UnderstoryTerrainWeights,
}

impl Default for UnderstoryTerrainConfig {
    fn default() -> Self {
        Self {
            grass: default_terrain_grass(),
            rock: default_terrain_rock(),
            sand: default_terrain_sand(),
            snow: default_terrain_snow(),
        }
    }
}

#[derive(Clone, Copy, Deserialize, Debug)]
pub struct UnderstoryTerrainWeights {
    #[serde(default = "default_weight_one")]
    pub density: f32,
    #[serde(default = "default_weight_one")]
    pub shrub: f32,
    #[serde(default = "default_weight_one")]
    pub fern: f32,
    #[serde(default = "default_weight_one")]
    pub sapling: f32,
    #[serde(default = "default_weight_one")]
    pub flower: f32,
    #[serde(default = "default_weight_one")]
    pub dead_log: f32,
    #[serde(default = "default_weight_one")]
    pub stump: f32,
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryClassesConfig {
    #[serde(default = "default_shrub_class")]
    pub shrub: UnderstoryClassConfig,
    #[serde(default = "default_fern_class")]
    pub fern: UnderstoryClassConfig,
    #[serde(default = "default_sapling_class")]
    pub sapling: UnderstoryClassConfig,
    #[serde(default = "default_flower_class")]
    pub flower: UnderstoryClassConfig,
    #[serde(default = "default_dead_log_class")]
    pub dead_log: UnderstoryClassConfig,
    #[serde(default = "default_stump_class")]
    pub stump: UnderstoryClassConfig,
}

impl Default for UnderstoryClassesConfig {
    fn default() -> Self {
        Self {
            shrub: default_shrub_class(),
            fern: default_fern_class(),
            sapling: default_sapling_class(),
            flower: default_flower_class(),
            dead_log: default_dead_log_class(),
            stump: default_stump_class(),
        }
    }
}

impl UnderstoryClassesConfig {
    pub fn get(&self, class: UnderstoryClass) -> &UnderstoryClassConfig {
        match class {
            UnderstoryClass::Shrub => &self.shrub,
            UnderstoryClass::Fern => &self.fern,
            UnderstoryClass::Sapling => &self.sapling,
            UnderstoryClass::Flower => &self.flower,
            UnderstoryClass::DeadLog => &self.dead_log,
            UnderstoryClass::Stump => &self.stump,
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryClassConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub asset_ids: Vec<String>,
    #[serde(default)]
    pub weight: f32,
    #[serde(default = "default_weight_one")]
    pub density: f32,
    #[serde(default = "default_min_scale")]
    pub min_scale: f32,
    #[serde(default = "default_max_scale")]
    pub max_scale: f32,
    #[serde(default)]
    pub height_preference: UnderstoryHeightPreference,
    #[serde(default = "default_mid_preference")]
    pub shade_preference: f32,
    #[serde(default = "default_mid_preference")]
    pub moisture_preference: f32,
    #[serde(default)]
    pub forest_edge_bias: f32,
    #[serde(default)]
    pub wind_weight: f32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnderstoryHeightPreference {
    Low,
    High,
    #[default]
    Any,
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryRenderConfig {
    #[serde(default)]
    pub debug_color_by_class: bool,
    #[serde(default = "default_alpha_test")]
    pub alpha_test: f32,
    #[serde(default)]
    pub shadows: bool,
    #[serde(default = "default_max_shadow_class")]
    pub max_shadow_class: UnderstoryClass,
}

impl Default for UnderstoryRenderConfig {
    fn default() -> Self {
        Self {
            debug_color_by_class: false,
            alpha_test: default_alpha_test(),
            shadows: false,
            max_shadow_class: default_max_shadow_class(),
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct UnderstoryGpuConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_enabled")]
    pub fallback_to_cpu: bool,
    #[serde(default)]
    pub debug_force_cpu: bool,
    #[serde(default = "default_max_instances")]
    pub max_visible: u32,
    #[serde(default = "default_workgroup_size")]
    pub workgroup_size: u32,
    #[serde(default = "default_enabled")]
    pub readback_visible_lists: bool,
    #[serde(default = "default_enabled")]
    pub debug_show_gpu_counts: bool,
    #[serde(default)]
    pub debug_validate_against_cpu: bool,
}

impl Default for UnderstoryGpuConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            fallback_to_cpu: true,
            debug_force_cpu: false,
            max_visible: default_max_instances(),
            workgroup_size: default_workgroup_size(),
            readback_visible_lists: true,
            debug_show_gpu_counts: true,
            debug_validate_against_cpu: false,
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct UnderstoryGenerationStats {
    pub generated_candidates: u32,
    pub accepted_candidates: u32,
    pub rejected_slope: u32,
    pub rejected_height: u32,
    pub rejected_material: u32,
    pub rejected_ecology: u32,
    pub rejected_spacing: u32,
    pub accepted_shrub: u32,
    pub accepted_fern: u32,
    pub accepted_sapling: u32,
    pub accepted_flower: u32,
    pub accepted_dead_log: u32,
    pub accepted_stump: u32,
}

impl UnderstoryGenerationStats {
    pub fn accepted_total(&self) -> u32 {
        self.accepted_shrub
            + self.accepted_fern
            + self.accepted_sapling
            + self.accepted_flower
            + self.accepted_dead_log
            + self.accepted_stump
    }
}

#[derive(Clone, Copy, Debug)]
struct UnderstoryEcologySample {
    forest_influence: f32,
    forest_edge: f32,
    shade: f32,
    moisture: f32,
    clearing: f32,
    density: f32,
    deadfall: f32,
}

#[derive(Clone)]
struct UnderstoryAsset<'a> {
    id: &'a str,
    prop_type: PropType,
    def: &'a PropDefinition,
}

#[derive(Clone, Debug)]
struct AcceptedUnderstory {
    x: f32,
    z: f32,
    spacing_radius: f32,
}

#[allow(clippy::too_many_arguments)]
pub fn generate_understory_props(
    props: &mut Vec<PropPlacementData>,
    stats: &mut UnderstoryGenerationStats,
    min_x: i32,
    min_z: i32,
    max_x: i32,
    max_z: i32,
    world: &VoxelWorld,
    generator: &TerrainGenerator<ValueNoise>,
    all_defs: &[(&PropDefinition, PropType)],
    placement_config: &PlacementConfig,
    protected_areas: Option<&ProtectedAreaRegistry>,
    config: &UnderstoryConfig,
) {
    if !config.enabled {
        return;
    }

    let catalog = build_asset_catalog(all_defs);
    if catalog.is_empty() {
        return;
    }

    let spacing = config.placement.spacing_m.max(0.25);
    let columns = (((max_x - min_x) as f32) / spacing).floor().max(0.0) as i32;
    let rows = (((max_z - min_z) as f32) / spacing).floor().max(0.0) as i32;
    let capacity = chunk_capacity(min_x, min_z, max_x, max_z, config);
    let mut ranked: Vec<(f32, PropPlacementData, AcceptedUnderstory)> = Vec::new();
    let mut accepted_spacing: Vec<AcceptedUnderstory> = Vec::new();

    for row in 0..rows {
        for column in 0..columns {
            stats.generated_candidates += 1;

            let grid_x = (min_x as f32 / spacing).floor() as i32 + column;
            let grid_z = (min_z as f32 / spacing).floor() as i32 + row;
            let base_x = min_x as f32 + (column as f32 + 0.5) * spacing;
            let base_z = min_z as f32 + (row as f32 + 0.5) * spacing;
            let x = (base_x
                + random_signed(grid_x, grid_z, config.seed + 101)
                    * spacing
                    * config.placement.jitter)
                .clamp(min_x as f32 + 0.001, max_x as f32 - 0.001);
            let z = (base_z
                + random_signed(grid_x, grid_z, config.seed + 211)
                    * spacing
                    * config.placement.jitter)
                .clamp(min_z as f32 + 0.001, max_z as f32 - 0.001);

            let analyzer = TerrainAnalyzer::new(world);
            let Some(sample) = analyzer.multi_sample_placement(
                x,
                z,
                spacing * 0.35 * placement_config.footprint_scale,
                spacing * 0.35 * placement_config.footprint_scale,
            ) else {
                stats.rejected_material += 1;
                continue;
            };

            if sample.position.y <= WATER_LEVEL as f32 {
                stats.rejected_height += 1;
                continue;
            }
            let normal_y = sample.normal.y.clamp(0.0, 1.0);
            if normal_y < config.placement.slope_min_y {
                stats.rejected_slope += 1;
                continue;
            }
            if sample.position.y < config.placement.min_height_m
                || sample.position.y > config.placement.max_height_m
            {
                stats.rejected_height += 1;
                continue;
            }

            let climate = generator.get_climate(x.floor() as i32, z.floor() as i32);
            if climate.standing_water {
                stats.rejected_material += 1;
                continue;
            }
            let weights = terrain_weights(sample.position.y, normal_y, climate);
            let terrain_bias = blend_terrain_bias(config, weights);
            let ground_weight = (weights[0] + weights[1] * 0.25) * terrain_bias.density;
            if ground_weight < config.placement.min_ground_weight {
                stats.rejected_material += 1;
                continue;
            }

            let ecology = sample_ecology(
                x,
                z,
                sample.position.y,
                normal_y,
                ground_weight,
                config,
                climate,
            );
            if ecology.forest_influence < config.placement.min_tree_influence {
                stats.rejected_ecology += 1;
                continue;
            }
            let acceptance = (0.06
                + ecology.density * 0.42
                + ecology.forest_influence * 0.28
                + ecology.forest_edge * 0.22
                + ecology.clearing * 0.12)
                .clamp(0.0, 1.0);
            if hash2(grid_x, grid_z, config.seed + 307) > acceptance {
                stats.rejected_ecology += 1;
                continue;
            }

            let Some(class) = select_class(
                ecology,
                sample.position.y,
                normal_y,
                config,
                hash2(grid_x, grid_z, config.seed + 409),
                terrain_bias,
                &catalog,
            ) else {
                stats.rejected_ecology += 1;
                continue;
            };
            let class_config = config.classes.get(class);
            if hash2(grid_x, grid_z, config.seed + 509) > class_config.density.min(1.0) {
                stats.rejected_ecology += 1;
                continue;
            }

            let spacing_radius = class_spacing_radius(class, spacing);
            if accepted_spacing.iter().any(|accepted| {
                let radius = spacing_radius.max(accepted.spacing_radius);
                let dx = accepted.x - x;
                let dz = accepted.z - z;
                dx * dx + dz * dz < radius * radius
            }) {
                stats.rejected_spacing += 1;
                continue;
            }

            let Some(asset) = select_asset(class, grid_x, grid_z, config, &catalog) else {
                stats.rejected_ecology += 1;
                continue;
            };

            let class_scale = lerp(
                class_config.min_scale,
                class_config.max_scale.max(class_config.min_scale),
                hash2(grid_x, grid_z, config.seed + 601),
            );
            let asset_scale = lerp(
                asset.def.scale_range[0],
                asset.def.scale_range[1].max(asset.def.scale_range[0]),
                hash2(grid_x, grid_z, config.seed + 617),
            );
            let scale = class_scale * asset_scale;
            let yaw = hash2(grid_x, grid_z, config.seed + 701) * std::f32::consts::TAU;
            let placement_seed = hash_to_seed(grid_x, grid_z, asset.id, config.seed);
            let tilt_x = (seeded_random(placement_seed, 1) - 0.5)
                * placement_config.max_random_tilt.to_radians();
            let tilt_z = (seeded_random(placement_seed, 2) - 0.5)
                * placement_config.max_random_tilt.to_radians();
            let rotation = calculate_prop_rotation(
                sample.normal,
                slope_align_strength(class),
                yaw,
                tilt_x,
                tilt_z,
            );
            let sink = ground_sink(class, scale);
            let position = Vec3::new(
                sample.position.x,
                sample.position.y + asset.def.y_offset - sink,
                sample.position.z,
            );

            if protected_areas
                .map(|registry| registry.prop_position_blocked(position))
                .unwrap_or(false)
            {
                continue;
            }

            let mut placement = PropPlacementData::new(
                asset.id.to_string(),
                asset.prop_type,
                position,
                quat_to_euler_degrees(rotation),
                Vec3::splat(scale),
                placement_seed,
            );
            placement.ground_contact = GroundContactData::new(
                sample.voxel_type,
                sample.normal.y.acos().to_degrees(),
                sample.normal,
            );
            placement.validated = true;

            accepted_spacing.push(AcceptedUnderstory {
                x,
                z,
                spacing_radius,
            });
            ranked.push((
                hash2(grid_x, grid_z, config.seed + 907),
                placement,
                AcceptedUnderstory {
                    x,
                    z,
                    spacing_radius,
                },
            ));
            stats.accepted_candidates += 1;
            increment_class_stats(stats, class);
        }
    }

    ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
    props.extend(
        ranked
            .into_iter()
            .take(capacity)
            .map(|(_, placement, _)| placement),
    );
}

pub fn understory_asset_ids(config: &UnderstoryConfig) -> Vec<String> {
    let mut out = Vec::new();
    for class in UnderstoryClass::ALL {
        let class_config = config.classes.get(class);
        let ids = if class_config.asset_ids.is_empty() {
            class.default_asset_ids()
        } else {
            class_config.asset_ids.clone()
        };
        for id in ids {
            out.push(id);
        }
    }
    out
}

fn build_asset_catalog<'a>(
    all_defs: &'a [(&'a PropDefinition, PropType)],
) -> HashMap<&'a str, UnderstoryAsset<'a>> {
    all_defs
        .iter()
        .map(|(def, prop_type)| {
            (
                def.id.as_str(),
                UnderstoryAsset {
                    id: def.id.as_str(),
                    prop_type: *prop_type,
                    def,
                },
            )
        })
        .collect()
}

fn chunk_capacity(
    min_x: i32,
    min_z: i32,
    max_x: i32,
    max_z: i32,
    config: &UnderstoryConfig,
) -> usize {
    if let Some(capacity) = config.max_instances_per_chunk {
        return capacity as usize;
    }
    let area = ((max_x - min_x).max(0) * (max_z - min_z).max(0)) as f32;
    let ring_area = (config.distance_m * 2.0).max(1.0).powi(2);
    ((config.max_instances as f32 * area / ring_area).ceil() as usize).max(1)
}

fn select_asset<'a>(
    class: UnderstoryClass,
    grid_x: i32,
    grid_z: i32,
    config: &UnderstoryConfig,
    catalog: &'a HashMap<&str, UnderstoryAsset<'a>>,
) -> Option<UnderstoryAsset<'a>> {
    let class_config = config.classes.get(class);
    let ids = if class_config.asset_ids.is_empty() {
        class.default_asset_ids()
    } else {
        class_config.asset_ids.clone()
    };
    let available: Vec<_> = ids
        .iter()
        .filter_map(|id| catalog.get(id.as_str()).cloned())
        .collect();
    if available.is_empty() {
        return None;
    }
    let index =
        (hash2(grid_x, grid_z, config.seed + 811) * available.len() as f32).floor() as usize;
    available.get(index.min(available.len() - 1)).cloned()
}

fn sample_ecology(
    x: f32,
    z: f32,
    height: f32,
    normal_y: f32,
    ground_weight: f32,
    config: &UnderstoryConfig,
    climate: ClimateSample,
) -> UnderstoryEcologySample {
    let ecology = &config.ecology;
    if !ecology.enabled {
        return UnderstoryEcologySample {
            forest_influence: 0.5,
            forest_edge: 0.5,
            shade: 0.5,
            moisture: 0.5,
            clearing: 0.5,
            density: ground_weight.clamp(0.0, 1.0),
            deadfall: 0.25,
        };
    }

    let base_forest = fractal_noise_2d(
        x,
        z,
        ecology.forest_influence_scale_m,
        config.seed + 21001,
        3,
    );
    let forest_influence = smoothstep(0.32, 0.78, base_forest);
    let edge_width = ecology.forest_edge_width_m.max(0.001);
    let outer = smoothstep(
        0.32 - 12.0 / edge_width,
        0.32 + 12.0 / edge_width,
        base_forest,
    );
    let inner = smoothstep(
        0.78 - 12.0 / edge_width,
        0.78 + 12.0 / edge_width,
        base_forest,
    );
    let forest_edge = outer.min(1.0 - inner).mul_add(1.45, 0.0).clamp(0.0, 1.0);
    let moisture_noise = fractal_noise_2d(
        x + 557.3,
        z - 811.9,
        ecology.moisture_noise_scale_m,
        config.seed + 22003,
        3,
    );
    let height_damp = 1.0
        - smoothstep(
            config.placement.min_height_m,
            config.placement.max_height_m,
            height,
        ) * 0.3;
    let moisture = (0.5
        + (moisture_noise - 0.5) * ecology.moisture_strength
        + height_damp * 0.16
        + climate.moisture * 0.18)
        .clamp(0.0, 1.0);
    let shade = (forest_influence * ecology.shade_strength
        + forest_edge * 0.2
        + climate.rock_exposure * 0.04)
        .clamp(0.0, 1.0);
    let clearing_noise = value_noise_2d(
        x - 109.2,
        z + 73.4,
        ecology.forest_influence_scale_m * 1.9,
        config.seed + 23011,
    );
    let clearing = ((1.0 - forest_influence) * 0.75
        + forest_edge * ecology.clearing_preference
        + clearing_noise * 0.2)
        .clamp(0.0, 1.0);
    let density_noise =
        fractal_noise_2d(x, z, ecology.density_noise_scale_m, config.seed + 24001, 2);
    let terrain_density =
        (ground_weight * smoothstep(config.placement.slope_min_y, 1.0, normal_y)).clamp(0.0, 1.0);
    let density = (terrain_density
        * (1.0 - ecology.density_noise_strength + density_noise * ecology.density_noise_strength))
        .clamp(0.0, 1.0);
    let old_forest = value_noise_2d(
        x + 991.7,
        z - 219.5,
        ecology.forest_influence_scale_m * 2.4,
        config.seed + 25013,
    );
    let deadfall = (forest_influence * (0.35 + old_forest * ecology.deadfall_old_forest_bias)
        + shade * 0.18
        + climate.rock_exposure * 0.08)
        .clamp(0.0, 1.0);

    UnderstoryEcologySample {
        forest_influence,
        forest_edge,
        shade,
        moisture,
        clearing,
        density,
        deadfall,
    }
}

fn select_class(
    ecology: UnderstoryEcologySample,
    height: f32,
    normal_y: f32,
    config: &UnderstoryConfig,
    roll: f32,
    terrain_bias: UnderstoryTerrainWeights,
    catalog: &HashMap<&str, UnderstoryAsset<'_>>,
) -> Option<UnderstoryClass> {
    let mut total = 0.0;
    let mut weights = [(UnderstoryClass::Shrub, 0.0); 6];
    for (index, class) in UnderstoryClass::ALL.into_iter().enumerate() {
        if !class_has_asset(class, config, catalog) {
            continue;
        }
        let weight = class_weight(class, ecology, height, normal_y, config)
            * terrain_class_weight(terrain_bias, class);
        weights[index] = (class, weight);
        total += weight;
    }
    if total <= 0.0 {
        return None;
    }
    let mut cursor = roll * total;
    for (class, weight) in weights {
        cursor -= weight;
        if cursor <= 0.0 && weight > 0.0 {
            return Some(class);
        }
    }
    None
}

fn class_has_asset(
    class: UnderstoryClass,
    config: &UnderstoryConfig,
    catalog: &HashMap<&str, UnderstoryAsset<'_>>,
) -> bool {
    let class_config = config.classes.get(class);
    let ids = if class_config.asset_ids.is_empty() {
        class.default_asset_ids()
    } else {
        class_config.asset_ids.clone()
    };
    ids.iter().any(|id| catalog.contains_key(id.as_str()))
}

fn class_weight(
    class: UnderstoryClass,
    sample: UnderstoryEcologySample,
    height: f32,
    normal_y: f32,
    config: &UnderstoryConfig,
) -> f32 {
    let class_config = config.classes.get(class);
    if !class_config.enabled || class_config.weight <= 0.0 || class_config.density <= 0.0 {
        return 0.0;
    }
    let height_t = smoothstep(
        config.placement.min_height_m,
        config.placement.max_height_m,
        height,
    );
    let height_weight = match class_config.height_preference {
        UnderstoryHeightPreference::Low => 1.0 - height_t * 0.75,
        UnderstoryHeightPreference::High => 0.35 + height_t * 0.9,
        UnderstoryHeightPreference::Any => 1.0,
    };
    let shade_weight = 1.0 - (sample.shade - class_config.shade_preference).abs() * 0.9;
    let moisture_weight = 1.0 - (sample.moisture - class_config.moisture_preference).abs() * 0.85;
    let edge_weight = 1.0 + sample.forest_edge * class_config.forest_edge_bias;
    let clearing_weight = if class == UnderstoryClass::Flower {
        0.45 + sample.clearing * 1.35
    } else {
        1.0
    };
    let canopy_weight = if class == UnderstoryClass::Sapling {
        0.42 + sample.forest_influence * 0.9 + sample.forest_edge * 0.35
    } else {
        1.0
    };
    let fern_weight = if class == UnderstoryClass::Fern {
        0.35 + sample.shade * 0.85 + sample.moisture * 0.75
    } else {
        1.0
    };
    let dead_weight = if matches!(class, UnderstoryClass::DeadLog | UnderstoryClass::Stump) {
        0.25 + sample.deadfall * 1.5
    } else {
        1.0
    };
    let slope_weight = (normal_y / config.placement.slope_min_y.max(0.001)).clamp(0.2, 1.15);
    (class_config.weight
        * class_config.density
        * sample.density
        * height_weight
        * shade_weight
        * moisture_weight
        * edge_weight
        * clearing_weight
        * canopy_weight
        * fern_weight
        * dead_weight
        * slope_weight)
        .max(0.0)
}

fn terrain_weights(height: f32, _normal_y: f32, climate: ClimateSample) -> [f32; 4] {
    let sand = (1.0 - (height - WATER_LEVEL as f32).abs() / 6.0).clamp(0.0, 1.0);
    let snow = climate.snow.max(((height - 88.0) / 22.0).clamp(0.0, 1.0));
    let rock = climate
        .rock_exposure
        .max(((height - 48.0) / 34.0).clamp(0.0, 1.0))
        * (1.0 - snow);
    let grass = (1.0 - sand - snow - rock).clamp(0.0, 1.0);
    let sum = (grass + rock + sand + snow).max(1e-5);
    [grass / sum, rock / sum, sand / sum, snow / sum]
}

fn blend_terrain_bias(config: &UnderstoryConfig, weights: [f32; 4]) -> UnderstoryTerrainWeights {
    let entries = [
        (config.terrain.grass, weights[0]),
        (config.terrain.rock, weights[1]),
        (config.terrain.sand, weights[2]),
        (config.terrain.snow, weights[3]),
    ];
    let mut out = UnderstoryTerrainWeights::zero();
    let mut sum = 0.0;
    for (entry, raw_weight) in entries {
        let weight = raw_weight.max(0.0);
        sum += weight;
        out.add_scaled(entry, weight);
    }
    if sum <= 0.0 {
        return UnderstoryTerrainWeights::one();
    }
    out.scale(1.0 / sum);
    out
}

impl UnderstoryTerrainWeights {
    fn one() -> Self {
        Self {
            density: 1.0,
            shrub: 1.0,
            fern: 1.0,
            sapling: 1.0,
            flower: 1.0,
            dead_log: 1.0,
            stump: 1.0,
        }
    }

    fn zero() -> Self {
        Self {
            density: 0.0,
            shrub: 0.0,
            fern: 0.0,
            sapling: 0.0,
            flower: 0.0,
            dead_log: 0.0,
            stump: 0.0,
        }
    }

    fn add_scaled(&mut self, other: Self, scale: f32) {
        self.density += other.density * scale;
        self.shrub += other.shrub * scale;
        self.fern += other.fern * scale;
        self.sapling += other.sapling * scale;
        self.flower += other.flower * scale;
        self.dead_log += other.dead_log * scale;
        self.stump += other.stump * scale;
    }

    fn scale(&mut self, scale: f32) {
        self.density *= scale;
        self.shrub *= scale;
        self.fern *= scale;
        self.sapling *= scale;
        self.flower *= scale;
        self.dead_log *= scale;
        self.stump *= scale;
    }
}

fn terrain_class_weight(weights: UnderstoryTerrainWeights, class: UnderstoryClass) -> f32 {
    match class {
        UnderstoryClass::Shrub => weights.shrub,
        UnderstoryClass::Fern => weights.fern,
        UnderstoryClass::Sapling => weights.sapling,
        UnderstoryClass::Flower => weights.flower,
        UnderstoryClass::DeadLog => weights.dead_log,
        UnderstoryClass::Stump => weights.stump,
    }
}

fn class_spacing_radius(class: UnderstoryClass, spacing: f32) -> f32 {
    match class {
        UnderstoryClass::DeadLog | UnderstoryClass::Stump => spacing * 1.7,
        UnderstoryClass::Flower | UnderstoryClass::Fern => spacing * 0.55,
        _ => spacing * 0.9,
    }
}

fn slope_align_strength(class: UnderstoryClass) -> f32 {
    match class {
        UnderstoryClass::DeadLog | UnderstoryClass::Stump => 0.7,
        UnderstoryClass::Flower => 0.2,
        UnderstoryClass::Fern => 0.35,
        _ => 0.5,
    }
}

fn ground_sink(class: UnderstoryClass, scale: f32) -> f32 {
    match class {
        UnderstoryClass::DeadLog => scale * 0.18,
        UnderstoryClass::Stump => scale * 0.25,
        UnderstoryClass::Flower => scale * 0.03,
        UnderstoryClass::Fern => scale * 0.05,
        UnderstoryClass::Shrub | UnderstoryClass::Sapling => scale * 0.08,
    }
}

fn increment_class_stats(stats: &mut UnderstoryGenerationStats, class: UnderstoryClass) {
    match class {
        UnderstoryClass::Shrub => stats.accepted_shrub += 1,
        UnderstoryClass::Fern => stats.accepted_fern += 1,
        UnderstoryClass::Sapling => stats.accepted_sapling += 1,
        UnderstoryClass::Flower => stats.accepted_flower += 1,
        UnderstoryClass::DeadLog => stats.accepted_dead_log += 1,
        UnderstoryClass::Stump => stats.accepted_stump += 1,
    }
}

fn hash2(x: i32, z: i32, seed: i32) -> f32 {
    let mut value = seed;
    value ^= x.wrapping_mul(0x27d4_eb2d);
    value ^= z.wrapping_mul(0x1656_67b1);
    value = (value ^ ((value as u32 >> 15) as i32)).wrapping_mul(0x85eb_ca6b_u32 as i32);
    value = (value ^ ((value as u32 >> 13) as i32)).wrapping_mul(0xc2b2_ae35_u32 as i32);
    ((value ^ ((value as u32 >> 16) as i32)) as u32 as f32) / 4_294_967_296.0
}

fn random_signed(x: i32, z: i32, seed: i32) -> f32 {
    hash2(x, z, seed) * 2.0 - 1.0
}

fn value_noise_2d(x: f32, z: f32, scale_m: f32, seed: i32) -> f32 {
    let scale = scale_m.max(0.001);
    let nx = x / scale;
    let nz = z / scale;
    let x0 = nx.floor() as i32;
    let z0 = nz.floor() as i32;
    let tx = smoothstep01(nx - x0 as f32);
    let tz = smoothstep01(nz - z0 as f32);
    let a = hash2(x0, z0, seed);
    let b = hash2(x0 + 1, z0, seed);
    let c = hash2(x0, z0 + 1, seed);
    let d = hash2(x0 + 1, z0 + 1, seed);
    lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
}

fn fractal_noise_2d(x: f32, z: f32, scale_m: f32, seed: i32, octaves: u32) -> f32 {
    let mut amplitude = 0.5;
    let mut frequency = 1.0;
    let mut total = 0.0;
    let mut weight = 0.0;
    for octave in 0..octaves {
        total += value_noise_2d(
            x * frequency,
            z * frequency,
            scale_m,
            seed + octave as i32 * 1013,
        ) * amplitude;
        weight += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    if weight > 0.0 {
        (total / weight).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if (edge1 - edge0).abs() <= 1e-8 {
        return if value < edge0 { 0.0 } else { 1.0 };
    }
    smoothstep01(((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0))
}

fn smoothstep01(value: f32) -> f32 {
    let t = value.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn hash_to_seed(x: i32, z: i32, id: &str, seed: i32) -> u64 {
    let id_hash: i32 = id.bytes().fold(seed, |acc, b| acc.wrapping_add(b as i32));
    let n = (x as i64)
        .wrapping_mul(374761393)
        .wrapping_add((z as i64).wrapping_mul(668265263))
        .wrapping_add((id_hash as i64).wrapping_mul(1274126177));
    n as u64
}

fn default_enabled() -> bool {
    true
}
fn default_seed() -> i32 {
    9137
}
fn default_distance_m() -> f32 {
    150.0
}
fn default_refresh_distance_m() -> f32 {
    12.0
}
fn default_max_new_patches_per_frame() -> u32 {
    2
}
fn default_max_instances() -> u32 {
    12_000
}
fn default_spacing_m() -> f32 {
    3.0
}
fn default_jitter() -> f32 {
    0.55
}
fn default_slope_min_y() -> f32 {
    0.68
}
fn default_min_height_m() -> f32 {
    8.0
}
fn default_max_height_m() -> f32 {
    52.0
}
fn default_min_ground_weight() -> f32 {
    0.12
}
fn default_forest_influence_scale_m() -> f32 {
    36.0
}
fn default_forest_edge_width_m() -> f32 {
    18.0
}
fn default_clearing_preference() -> f32 {
    0.55
}
fn default_moisture_noise_scale_m() -> f32 {
    80.0
}
fn default_moisture_strength() -> f32 {
    0.65
}
fn default_shade_strength() -> f32 {
    0.75
}
fn default_density_noise_scale_m() -> f32 {
    28.0
}
fn default_density_noise_strength() -> f32 {
    0.55
}
fn default_deadfall_old_forest_bias() -> f32 {
    0.75
}
fn default_weight_one() -> f32 {
    1.0
}
fn default_mid_preference() -> f32 {
    0.5
}
fn default_min_scale() -> f32 {
    0.7
}
fn default_max_scale() -> f32 {
    1.2
}
fn default_alpha_test() -> f32 {
    0.45
}
fn default_max_shadow_class() -> UnderstoryClass {
    UnderstoryClass::Shrub
}
fn default_workgroup_size() -> u32 {
    64
}

fn terrain_weights_config(
    density: f32,
    shrub: f32,
    fern: f32,
    sapling: f32,
    flower: f32,
    dead_log: f32,
    stump: f32,
) -> UnderstoryTerrainWeights {
    UnderstoryTerrainWeights {
        density,
        shrub,
        fern,
        sapling,
        flower,
        dead_log,
        stump,
    }
}

fn default_terrain_grass() -> UnderstoryTerrainWeights {
    terrain_weights_config(1.20, 1.00, 1.18, 0.92, 1.30, 0.60, 0.65)
}
fn default_terrain_rock() -> UnderstoryTerrainWeights {
    terrain_weights_config(0.48, 0.62, 0.24, 0.55, 0.08, 1.35, 1.28)
}
fn default_terrain_sand() -> UnderstoryTerrainWeights {
    terrain_weights_config(0.62, 0.44, 0.22, 0.24, 0.75, 0.48, 0.44)
}
fn default_terrain_snow() -> UnderstoryTerrainWeights {
    terrain_weights_config(0.18, 0.30, 0.10, 0.12, 0.02, 1.60, 1.35)
}

fn class_defaults(
    class: UnderstoryClass,
    weight: f32,
    density: f32,
    min_scale: f32,
    max_scale: f32,
    height_preference: UnderstoryHeightPreference,
    shade_preference: f32,
    moisture_preference: f32,
    forest_edge_bias: f32,
    wind_weight: f32,
) -> UnderstoryClassConfig {
    UnderstoryClassConfig {
        enabled: true,
        asset_ids: class.default_asset_ids(),
        weight,
        density,
        min_scale,
        max_scale,
        height_preference,
        shade_preference,
        moisture_preference,
        forest_edge_bias,
        wind_weight,
    }
}

fn default_shrub_class() -> UnderstoryClassConfig {
    class_defaults(
        UnderstoryClass::Shrub,
        0.30,
        1.0,
        0.7,
        1.6,
        UnderstoryHeightPreference::Any,
        0.55,
        0.45,
        0.65,
        0.35,
    )
}
fn default_fern_class() -> UnderstoryClassConfig {
    class_defaults(
        UnderstoryClass::Fern,
        0.24,
        1.0,
        0.55,
        1.25,
        UnderstoryHeightPreference::Low,
        0.85,
        0.80,
        0.25,
        0.55,
    )
}
fn default_sapling_class() -> UnderstoryClassConfig {
    class_defaults(
        UnderstoryClass::Sapling,
        0.16,
        0.55,
        0.45,
        1.15,
        UnderstoryHeightPreference::Any,
        0.45,
        0.50,
        0.55,
        0.45,
    )
}
fn default_flower_class() -> UnderstoryClassConfig {
    class_defaults(
        UnderstoryClass::Flower,
        0.18,
        0.85,
        0.35,
        0.95,
        UnderstoryHeightPreference::Low,
        0.15,
        0.45,
        0.85,
        0.65,
    )
}
fn default_dead_log_class() -> UnderstoryClassConfig {
    class_defaults(
        UnderstoryClass::DeadLog,
        0.08,
        0.22,
        0.8,
        1.9,
        UnderstoryHeightPreference::Any,
        0.75,
        0.55,
        0.30,
        0.0,
    )
}
fn default_stump_class() -> UnderstoryClassConfig {
    class_defaults(
        UnderstoryClass::Stump,
        0.04,
        0.16,
        0.7,
        1.4,
        UnderstoryHeightPreference::Any,
        0.65,
        0.45,
        0.25,
        0.0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fern_prefers_damp_shade() {
        let config = UnderstoryConfig::default();
        let damp_shade = UnderstoryEcologySample {
            forest_influence: 0.8,
            forest_edge: 0.2,
            shade: 0.9,
            moisture: 0.85,
            clearing: 0.15,
            density: 0.8,
            deadfall: 0.2,
        };
        let clearing = UnderstoryEcologySample {
            forest_influence: 0.15,
            forest_edge: 0.7,
            shade: 0.1,
            moisture: 0.4,
            clearing: 0.9,
            density: 0.8,
            deadfall: 0.1,
        };
        assert!(
            class_weight(UnderstoryClass::Fern, damp_shade, 18.0, 1.0, &config)
                > class_weight(UnderstoryClass::Flower, damp_shade, 18.0, 1.0, &config)
        );
        assert!(
            class_weight(UnderstoryClass::Flower, clearing, 18.0, 1.0, &config)
                > class_weight(UnderstoryClass::Fern, clearing, 18.0, 1.0, &config)
        );
    }

    #[test]
    fn terrain_bias_blends_class_weights() {
        let config = UnderstoryConfig::default();
        let grass = blend_terrain_bias(&config, [1.0, 0.0, 0.0, 0.0]);
        let rock = blend_terrain_bias(&config, [0.0, 1.0, 0.0, 0.0]);
        assert!(grass.fern > rock.fern);
        assert!(rock.dead_log > grass.dead_log);
    }
}
