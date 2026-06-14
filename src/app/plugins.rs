use std::time::Duration;

use bevy::app::ScheduleRunnerPlugin;
use bevy::log::LogPlugin;
use bevy::prelude::*;

use crate::editor::bridge::EditorRuntimeBridgePlugin;
use crate::editor::runtime::RuntimeWriteCommandPlugin;
use crate::rendering::quality::RenderQualityPreset;
use crate::shared::constants::{
    DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z,
};
use crate::voxel::meshing::{MeshMode, MeshSettings};
use crate::voxel::plugin::WorldConfig;
use crate::voxel::world::{VoxelWorld, WorldBounds};
use crate::world::rules::ProtectedAreaRegistry;

pub(super) fn run_editor_runtime(log_filter: String) {
    let size_chunks = IVec3::new(
        DEFAULT_WORLD_CHUNKS_X,
        DEFAULT_WORLD_CHUNKS_Y,
        DEFAULT_WORLD_CHUNKS_Z,
    );

    info!("Starting Drusniel editor runtime without a native Bevy window");

    let mut app = App::new();
    app.add_plugins(MinimalPlugins.set(ScheduleRunnerPlugin::run_loop(Duration::from_millis(16))))
        .add_plugins(LogPlugin {
            filter: log_filter,
            level: bevy::log::Level::TRACE,
            ..default()
        })
        .insert_resource(WorldConfig {
            size_chunks,
            chunk_size: crate::shared::constants::CHUNK_SIZE_I32,
            greedy_meshing: true,
        })
        .insert_resource(WorldBounds::from_size_chunks(size_chunks))
        .insert_resource(VoxelWorld::new(size_chunks))
        .insert_resource(MeshSettings {
            mode: MeshMode::SurfaceNets,
            ..default()
        })
        .insert_resource(RenderQualityPreset::default())
        .add_plugins(crate::content::ContentPlugin)
        .insert_resource(ProtectedAreaRegistry::default())
        .add_plugins(RuntimeWriteCommandPlugin)
        .add_plugins(EditorRuntimeBridgePlugin::enabled());

    app.run();
}
