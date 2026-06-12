//! CLOD pages Bevy plugin. Registers default-off source meshing and async page builds.

use bevy::prelude::*;

use super::build_queue::{
    clod_pages_build_queue_system, clod_pages_build_task_poll_system, ClodPageBuildQueue,
    ClodPageTree,
};
use super::runtime::{
    clod_pages_debug_toggle_system, clod_pages_source_meshing_system, clod_pages_startup_log_system,
    ClodPagesRuntime, PageExportCache,
};

pub struct ClodPagesPlugin;

impl Plugin for ClodPagesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodPagesRuntime>()
            .init_resource::<PageExportCache>()
            .init_resource::<ClodPageBuildQueue>()
            .init_resource::<ClodPageTree>()
            .add_systems(Startup, clod_pages_startup_log_system)
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
            );
    }
}
