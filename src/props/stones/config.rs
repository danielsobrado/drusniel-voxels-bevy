//! Stone-prop configuration, loaded from `assets/config/stones.yaml`.
//!
//! Mirrors the CLOD-PoC `stone_config.ts` so the two implementations can be diffed. Slope is
//! expressed as terrain normal.y (1 = flat, lower = steeper). Config-driven: no hardcoded class
//! distances / sink factors in the scatter.

use bevy::prelude::Resource;
use serde::Deserialize;

use super::rock_mesh::RockPreset;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
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

#[derive(Clone, Debug, Deserialize)]
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

#[derive(Resource, Clone, Debug, Deserialize)]
#[serde(default)]
pub struct StoneConfig {
    pub enabled: bool,
    pub seed_salt: i32,
    pub cell_size_m: f32,
    pub max_instances: usize,
    pub density: f32,
    /// normal.y at/above which slope imposes no penalty.
    pub slope_repose_start: f32,
    /// normal.y below which a site is fully rejected (too steep to hold stones).
    pub slope_repose: f32,
    /// reject candidates below the water surface + this margin (m).
    pub water_margin_m: f32,
    pub stream_large_bias: f32,
    pub cliff_probe_near_m: f32,
    pub cliff_probe_far_m: f32,
    pub sink_slope_multiplier: f32,
    pub normal_lean: f32,
    pub large: StoneClassConfig,
    pub medium: StoneClassConfig,
    pub small: StoneClassConfig,
}

impl StoneConfig {
    pub fn class(&self, id: StoneClassId) -> &StoneClassConfig {
        match id {
            StoneClassId::Large => &self.large,
            StoneClassId::Medium => &self.medium,
            StoneClassId::Small => &self.small,
        }
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
            cell_size_m: 2.1,
            max_instances: 350_000,
            density: 1.0,
            slope_repose_start: 0.78,
            slope_repose: 0.5,
            water_margin_m: 0.5,
            stream_large_bias: 0.16,
            cliff_probe_near_m: 8.0,
            cliff_probe_far_m: 18.0,
            sink_slope_multiplier: 0.9,
            normal_lean: 0.4,
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
