//! CLOD pages Bevy plugin. Registers default-off source meshing and async page builds.

use bevy::prelude::*;

use crate::voxel::runtime::VoxelTerrainSet;

use super::build_queue::{
    ClodPageBuildQueue, ClodPageTree, clod_pages_build_queue_system,
    clod_pages_build_task_poll_system,
};
use super::ownership::clod_page_chunk_ownership_system;
use super::render::{
    ClodPageMeshCommitState, ClodPagesShow, clod_page_mesh_commit_needed,
    clod_page_mesh_commit_system, clod_pages_show_startup_log_system,
};
use super::runtime::{
    ClodPagesRuntime, PageExportCache, clod_pages_debug_toggle_system,
    clod_pages_source_meshing_system, clod_pages_startup_log_system,
};
use super::selection::{
    ClodPageSelectionIndex, ClodPageSelectionState, clod_page_selection_system,
};

pub struct ClodPagesPlugin;

impl Plugin for ClodPagesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodPagesRuntime>()
            .init_resource::<PageExportCache>()
            .init_resource::<ClodPageBuildQueue>()
            .init_resource::<ClodPageTree>()
            .init_resource::<ClodPagesShow>()
            .init_resource::<ClodPageMeshCommitState>()
            .init_resource::<ClodPageSelectionIndex>()
            .init_resource::<ClodPageSelectionState>()
            .add_systems(
                Startup,
                (
                    clod_pages_startup_log_system,
                    clod_pages_show_startup_log_system.after(clod_pages_startup_log_system),
                ),
            )
            // Reads VoxelWorld immutably; the scheduler serializes it after the dirty mesher.
            .add_systems(
                Update,
                (
                    clod_pages_debug_toggle_system,
                    clod_pages_source_meshing_system,
                ),
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
                clod_page_mesh_commit_system
                    .after(clod_pages_build_task_poll_system)
                    .run_if(clod_page_mesh_commit_needed),
            )
            .add_systems(
                Update,
                clod_page_selection_system.after(clod_page_mesh_commit_system),
            )
            .add_systems(
                Update,
                clod_page_chunk_ownership_system
                    .after(clod_page_selection_system)
                    .after(VoxelTerrainSet::MeshDirty),
            );
    }
}
