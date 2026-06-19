//! Stone-prop configuration, loaded from `assets/config/stones.yaml`.
//!
//! Mirrors the CLOD-PoC `stone_config.ts` so the two implementations can be diffed. Slope is
//! expressed as terrain normal.y (1 = flat, lower = steeper). Config-driven: no hardcoded class
//! distances / sink factors in the scatter.

use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};

use super::rock_mesh::RockPreset;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StoneClassId {
    Large,
    Medium,
    Small,
}

impl StoneClassId {
    pub const ALL: [StoneClassId; 3] = [
        StoneClassId::Large,
        StoneClassId::Medium,
        StoneClassId::Small,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            StoneClassId::Large => "large",
            StoneClassId::Medium => "medium",
            StoneClassId::Small => "small",
        }
    }

    /// Base class-selection weight before context bias (small most common).
    pub fn base_weight(self) -> f32 {
        match self {
            StoneClassId::Large => 0.1,
            StoneClassId::Medium => 0.32,
            StoneClassId::Small => 0.58,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct StoneClassConfig {
    pub radius_min: f32,
    pub radius_max: f32,
    pub max_distance_m: f32,
    pub sink: f32,
    pub lod_details: Vec<u32>,
    pub variants: u32,
    pub presets: Vec<RockPreset>,
    pub shadows: bool,
}

#[derive(Resource, Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct StoneConfig {
    pub enabled: bool,
    pub seed_salt: i32,
    pub save_directory: String,
    pub cell_size_m: f32,
    pub max_instances: usize,
    pub max_instances_per_chunk: usize,
    pub density: f32,
    pub stress_density_multiplier: f32,
    /// normal.y at/above which slope imposes no penalty.
    pub slope_repose_start: f32,
    /// normal.y below which a site is fully rejected (too steep to hold stones).
    pub slope_repose: f32,
    /// reject candidates below the water surface + this margin (m).
    pub water_margin_m: f32,
    pub standing_water_cutoff_m: f32,
    pub stream_large_bias: f32,
    pub cliff_probe_near_m: f32,
    pub cliff_probe_far_m: f32,
    pub cliff_rise_start: f32,
    pub cliff_rise_end: f32,
    pub streambed_depth_scale: f32,
    pub snow_fade: f32,
    pub rock_exposure_weight: f32,
    pub scree_weight: f32,
    pub cliff_above_weight: f32,
    pub stream_weight: f32,
    pub base_soil_weight: f32,
    pub patch_clump_min: f32,
    pub patch_clump_cell_mult: f32,
    pub sink_slope_multiplier: f32,
    pub normal_lean: f32,
    pub debug: StoneDebugConfig,
    pub large: StoneClassConfig,
    pub medium: StoneClassConfig,
    pub small: StoneClassConfig,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct StoneDebugConfig {
    pub class_colors: bool,
    pub large_only: bool,
    pub medium_only: bool,
    pub small_only: bool,
    pub rejected_water_map: bool,
    pub slope_repose_heatmap: bool,
    pub streambed_heatmap: bool,
    pub cliff_above_heatmap: bool,
    pub rock_base_patch_heatmap: bool,
    pub candidate_grid: bool,
}

impl StoneConfig {
    pub fn class(&self, id: StoneClassId) -> &StoneClassConfig {
        match id {
            StoneClassId::Large => &self.large,
            StoneClassId::Medium => &self.medium,
            StoneClassId::Small => &self.small,
        }
    }

    pub fn config_hash(&self) -> u64 {
        stable_hash(
            serde_yaml::to_string(self)
                .unwrap_or_else(|_| format!("{self:?}"))
                .as_bytes(),
        )
    }
}

impl Default for StoneClassConfig {
    fn default() -> Self {
        Self {
            radius_min: 0.2,
            radius_max: 0.6,
            max_distance_m: 280.0,
            sink: 0.26,
            lod_details: vec![2, 1],
            variants: 4,
            presets: vec![RockPreset::Cobble],
            shadows: false,
        }
    }
}

impl Default for StoneConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            seed_salt: 931_777,
            save_directory: "stones".to_string(),
            cell_size_m: 2.1,
            max_instances: 350_000,
            max_instances_per_chunk: 5_000,
            density: 1.0,
            stress_density_multiplier: 1.0,
            slope_repose_start: 0.78,
            slope_repose: 0.5,
            water_margin_m: 0.5,
            standing_water_cutoff_m: 0.0,
            stream_large_bias: 0.16,
            cliff_probe_near_m: 8.0,
            cliff_probe_far_m: 18.0,
            cliff_rise_start: 0.7,
            cliff_rise_end: 1.3,
            streambed_depth_scale: 6.0,
            snow_fade: 0.85,
            rock_exposure_weight: 0.85,
            scree_weight: 0.85,
            cliff_above_weight: 1.15,
            stream_weight: 1.5,
            base_soil_weight: 0.16,
            patch_clump_min: 0.35,
            patch_clump_cell_mult: 3.0,
            sink_slope_multiplier: 0.9,
            normal_lean: 0.4,
            debug: StoneDebugConfig::default(),
            large: StoneClassConfig {
                radius_min: 0.6,
                radius_max: 2.2,
                max_distance_m: 900.0,
                sink: 0.3,
                lod_details: vec![3, 2],
                variants: 4,
                presets: vec![RockPreset::Talus, RockPreset::Boulder],
                shadows: true,
            },
            medium: StoneClassConfig {
                radius_min: 0.2,
                radius_max: 0.6,
                max_distance_m: 280.0,
                sink: 0.26,
                lod_details: vec![2, 1],
                variants: 4,
                presets: vec![RockPreset::Cobble, RockPreset::Talus],
                shadows: false,
            },
            small: StoneClassConfig {
                radius_min: 0.06,
                radius_max: 0.2,
                max_distance_m: 90.0,
                sink: 0.22,
                lod_details: vec![1],
                variants: 4,
                presets: vec![RockPreset::Cobble],
                shadows: false,
            },
        }
    }
}

fn stable_hash(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_hash_changes_with_tuning() {
        let a = StoneConfig::default();
        let mut b = a.clone();
        b.seed_salt += 1;
        assert_ne!(a.config_hash(), b.config_hash());
    }
}
