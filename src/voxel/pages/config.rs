//! Shared config — the SAME config/clod_pages.yaml the PoC and clod-rs consume, embedded at
//! compile time so the builder needs no runtime asset path. The PoC validated these numbers.

use serde::Deserialize;

const CONFIG_YAML: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/config/clod_pages.yaml"));

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

#[derive(Deserialize, Clone)]
pub struct NearFieldCfg {
    pub radius_chunks: i32,
}

#[derive(Deserialize, Clone)]
pub struct ClodPagesConfig {
    pub page: PageCfg,
    pub simplify: SimplifyCfg,
    pub near_field: NearFieldCfg,
}

impl ClodPagesConfig {
    pub fn load() -> Self {
        serde_yaml::from_str(CONFIG_YAML).expect("parse config/clod_pages.yaml")
    }
}
