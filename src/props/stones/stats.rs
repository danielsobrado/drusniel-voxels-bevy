//! Stone runtime counters recorded into the diagnostics timing stream.

use bevy::prelude::Resource;

#[derive(Resource, Clone, Debug, Default)]
pub struct StoneRuntimeStats {
    pub total: usize,
    pub large: usize,
    pub medium: usize,
    pub small: usize,
    pub visible: usize,
    pub lod0: usize,
    pub lod1: usize,
    pub rejected_water: usize,
    pub rejected_slope: usize,
    pub rejected_snow: usize,
    pub rejected_protected: usize,
    pub avg_sink: f32,
    pub max_float_error: f32,
    pub chunk_regen_count: usize,
    pub config_hash: u64,
}
