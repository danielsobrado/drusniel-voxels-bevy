//! Stub types when `mc_transvoxel` feature is disabled at compile time.

use bevy::prelude::*;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct McTransvoxelStats {
    pub regular_chunks_meshed: u32,
    pub transition_faces_meshed: [u32; 6],
    pub transition_triangles_total: u32,
    pub skipped_lod_delta_gt_one: u32,
    pub skipped_missing_neighbor: u32,
    pub mesh_generation_ms_total: f32,
    pub triangle_count_regular: u32,
    pub triangle_count_transition: u32,
}

#[derive(Resource, Clone, Debug)]
pub struct McTransvoxelSettings {
    pub enabled: bool,
    pub mode: McTransvoxelSpikeMode,
    pub lod_delta_policy: McTransvoxelLodDeltaPolicy,
    pub debug_triangle_sources: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum McTransvoxelSpikeMode {
    #[default]
    Sandbox,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum McTransvoxelLodDeltaPolicy {
    #[default]
    MaxOne,
}

impl Default for McTransvoxelSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: McTransvoxelSpikeMode::Sandbox,
            lod_delta_policy: McTransvoxelLodDeltaPolicy::MaxOne,
            debug_triangle_sources: false,
        }
    }
}

impl McTransvoxelSettings {
    pub fn load_or_default() -> Self {
        Self::default()
    }

    pub fn should_mesh_chunk(
        &self,
        _chunk_pos: IVec3,
        _camera_chunk: Option<IVec3>,
        _logical_lod: crate::voxel::chunk::LodLevel,
    ) -> bool {
        false
    }
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct McTransvoxelRuntimeStats {
    pub aggregated: McTransvoxelStats,
    pub chunks_meshed_this_frame: u32,
}

pub fn log_transition_stats_if_due(
    _settings: &McTransvoxelSettings,
    _stats: &McTransvoxelRuntimeStats,
    _frame: u32,
) {
}

pub const MC_TRANSVOXEL_CONFIG_PATH: &str = "assets/config/mc_transvoxel.yaml";
