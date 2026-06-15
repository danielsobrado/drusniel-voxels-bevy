//! Shared config — the SAME config/clod_pages.yaml the PoC and clod-rs consume, embedded at
//! compile time so the builder needs no runtime asset path. The PoC validated these numbers.

use serde::Deserialize;

const CONFIG_YAML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/config/clod_pages.yaml"
));

#[derive(Deserialize, Clone)]
pub struct PageCfg {
    pub chunks_per_page: usize,
    pub chunk_size: usize,
    pub halo_chunks: usize,
    pub quadtree_levels: usize,
}

#[derive(Deserialize, Clone)]
pub struct AttributeWeights {
    pub normal: f32,
    pub material: f32,
}

#[derive(Deserialize, Clone)]
pub struct SimplifyCfg {
    pub target_ratio_per_level: f32,
    pub abandon_ratio: f32,
    pub target_error: f32,
    pub weld_epsilon_cells: f32,
    pub attribute_weights: AttributeWeights,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct DiagonalFlipConfig {
    pub enabled: bool,
    pub min_triangle_area: f32,
    pub min_normal_dot: f32,
    pub min_angle_improvement_degrees: f32,
    pub normal_error_weight: f32,
    pub angle_quality_weight: f32,
    pub material_error_weight: f32,
}

impl Default for DiagonalFlipConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_triangle_area: 0.000001,
            min_normal_dot: 0.05,
            min_angle_improvement_degrees: 2.0,
            normal_error_weight: 1.0,
            angle_quality_weight: 1.0,
            material_error_weight: 0.25,
        }
    }
}

#[derive(Deserialize, Clone, Default)]
#[serde(default)]
pub struct PolishCfg {
    pub diagonal_flip: DiagonalFlipConfig,
}

#[derive(Deserialize, Clone)]
pub struct NearFieldCfg {
    pub radius_chunks: i32,
}

#[derive(Deserialize, Clone)]
pub struct SelectionCfg {
    pub error_threshold_px: f32,
    pub hysteresis_merge_factor: f32,
    pub neighbor_level_delta_max: i32,
    pub transition_mode: String,
    pub crossfade_frames: u32,
}

#[derive(Deserialize, Clone)]
pub struct ClodPagesConfig {
    pub page: PageCfg,
    pub simplify: SimplifyCfg,
    #[serde(default)]
    pub polish: PolishCfg,
    pub selection: SelectionCfg,
    pub near_field: NearFieldCfg,
}

impl ClodPagesConfig {
    pub fn load() -> Self {
        serde_yaml::from_str(CONFIG_YAML).expect("parse config/clod_pages.yaml")
    }
}
