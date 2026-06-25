//! CLOD pages Bevy plugin. Registers default-off source capture and async page builds.

use bevy::prelude::*;

use crate::voxel::runtime::VoxelTerrainSet;

use super::build_queue::{
    ClodPageBuildQueue, ClodPageTree, clod_pages_build_queue_system,
    clod_pages_build_task_poll_system,
};
use super::ownership::{
    ClodPageMeshGate, clod_page_chunk_ownership_system, refresh_clod_page_mesh_gate_system,
};
use super::render::{ClodPageMeshCommitState, clod_page_mesh_commit_system};
use super::runtime::{
    ClodPagesRuntime, PageExportCache, clod_pages_source_meshing_system,
    clod_pages_startup_log_system,
};
use super::selection::{
    ClodPageSelectionIndex, ClodPageSelectionState, clod_page_selection_system,
};
use super::summary::{
    TerrainSummaryField, TerrainSummaryRebuildState, terrain_summary_rebuild_system,
};

pub struct ClodPagesPlugin;

impl Plugin for ClodPagesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodPagesRuntime>()
            .init_resource::<PageExportCache>()
            .init_resource::<ClodPageBuildQueue>()
            .init_resource::<ClodPageTree>()
            .init_resource::<ClodPageMeshCommitState>()
            .init_resource::<ClodPageSelectionIndex>()
            .init_resource::<ClodPageSelectionState>()
            .init_resource::<ClodPageMeshGate>()
            .init_resource::<TerrainSummaryField>()
            .init_resource::<TerrainSummaryRebuildState>()
            .add_systems(Startup, clod_pages_startup_log_system)
            // Reads VoxelWorld immutably; the scheduler serializes it after the dirty mesher.
            .add_systems(
                Update,
                clod_pages_source_meshing_system.after(VoxelTerrainSet::MeshDirty),
            )
            .add_systems(
                Update,
                clod_pages_build_queue_system.after(clod_pages_source_meshing_system),
            )
            .add_systems(
                Update,
                clod_pages_build_task_poll_system.after(clod_pages_build_queue_system),
            )
            .add_systems(
                Update,
                clod_page_mesh_commit_system.after(clod_pages_build_task_poll_system),
            )
            .add_systems(
                Update,
                clod_page_selection_system.after(clod_page_mesh_commit_system),
            )
            .add_systems(
                Update,
                (
                    refresh_clod_page_mesh_gate_system,
                    terrain_summary_rebuild_system,
                )
                    .chain()
                    .after(clod_page_selection_system),
            )
            .add_systems(
                Update,
                refresh_clod_page_mesh_gate_system
                    .before(crate::voxel::runtime::update_chunk_lod_system),
            )
            .add_systems(
                Update,
                clod_page_chunk_ownership_system
                    .after(refresh_clod_page_mesh_gate_system)
                    .after(VoxelTerrainSet::MeshDirty),
            );
    }
}
