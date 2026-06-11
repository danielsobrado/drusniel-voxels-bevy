//! Loads the shared repo-root config/clod_pages.yaml — the SAME file the PoC consumes.
//! The PoC validated these numbers; the port does not fork them (plan §6).

use serde::Deserialize;

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
pub struct ClodPagesConfig {
    pub page: PageCfg,
    pub simplify: SimplifyCfg,
}

impl ClodPagesConfig {
    /// Load from config/clod_pages.yaml at the repo root (relative to this crate).
    pub fn load() -> Self {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../config/clod_pages.yaml");
        let text = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("read {path}: {e}"));
        serde_yaml::from_str(&text).expect("parse clod_pages.yaml")
    }
}
