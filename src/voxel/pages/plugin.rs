//! CLOD pages Bevy plugin. Step 3a: registers the default-off source-meshing system.
//! Decimation/commit/selection systems are added here as later steps land.

use bevy::prelude::*;

use super::runtime::{
    clod_pages_debug_toggle_system, clod_pages_source_meshing_system, ClodPagesRuntime,
    PageExportCache,
};

pub struct ClodPagesPlugin;

impl Plugin for ClodPagesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodPagesRuntime>()
            .init_resource::<PageExportCache>()
            // Reads VoxelWorld immutably; the scheduler serializes it after the dirty mesher.
            .add_systems(
                Update,
                (clod_pages_debug_toggle_system, clod_pages_source_meshing_system),
            );
    }
}
