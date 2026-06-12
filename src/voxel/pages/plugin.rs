//! CLOD pages Bevy plugin. Registers default-off source meshing and async page builds.

use bevy::prelude::*;

use super::build_queue::{
    clod_pages_build_queue_system, clod_pages_build_task_poll_system, ClodPageBuildQueue,
    ClodPageTree,
};
use super::render::{
    clod_page_mesh_commit_needed, clod_page_mesh_commit_system,
    clod_pages_show_startup_log_system, ClodPageMeshCommitState, ClodPagesShow,
};
use super::runtime::{
    clod_pages_debug_toggle_system, clod_pages_source_meshing_system, clod_pages_startup_log_system,
    ClodPagesRuntime, PageExportCache,
};
use super::selection::{
    clod_page_selection_system, ClodPageSelectionIndex, ClodPageSelectionState,
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
            );
    }
}
