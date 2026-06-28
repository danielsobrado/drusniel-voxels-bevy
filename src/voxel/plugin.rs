//! Voxel world plugin for chunk management and terrain generation.
//!
//! This module provides the core voxel functionality including:
//! - Procedural terrain generation with biomes, caves, dungeons, and trees
//! - Chunk-based world management with LOD (Level of Detail)
//! - Mesh generation and update systems
//! - Async chunk generation using Bevy's task pool

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponentPlugin;

use crate::constants::{DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z};
use crate::performance::AreaTimingRecorder;
use crate::voxel::diagnostics::seam_audit_pass::SeamAuditPassPlugin;
use crate::voxel::enclosure::{
    EnclosureOcclusionStats, EnclosureState, toggle_enclosure_culling, update_enclosure_state,
};
use crate::voxel::hole_probe::TerrainHoleProbePlugin;
#[allow(unused_imports)]
pub(crate) use crate::voxel::lod::{
    LodSettings, build_terrain_neighbor_lods, chunk_contains_liquid,
    chunk_layer_intersects_waterline, collect_water_shore_lod_guard_chunks,
    effective_terrain_mesh_lod_for_chunk, forensics_mesh_mode_override, is_horizon_proxy_lod,
    resolve_terrain_mesh_mode, should_defer_surface_nets_mesh, target_terrain_mesh_mode_for_lod,
    terrain_lod_distance_xz, terrain_lod_hysteresis, terrain_lod_requires_collider,
    terrain_material_quality_for_lod,
};
use crate::voxel::mc_transvoxel::{McTransvoxelRuntimeStats, McTransvoxelSettings};
use crate::voxel::mesh_commit::LodMeshTransactionState;
use crate::voxel::meshing::{ChunkMesh, MeshMode, MeshSettings, WaterMesh, WaterMeshDetail};
use crate::voxel::occlusion::{
    OcclusionConfig, OcclusionUpdateTimer, VisibleChunks, update_visible_chunks_system,
};
use crate::voxel::persistence::WorldPersistence;
use crate::voxel::world::{VoxelWorld, WorldBounds};
use crate::world::source::ProceduralWorldSource;

pub use crate::voxel::runtime::{
    ChunkGenerationState, RuntimeChunkStats, TerrainLodControl, VoxelTerrainSet, WaterBodyInfo,
    WaterBodyRegistry, WorldConfig, apply_visibility_culling_system,
};
pub(crate) use crate::voxel::runtime::{
    MeshDirtyQueueWarningState, PendingWorldGeneration, TerrainLodTransitionState, WaterMaskProxy,
    WorldGenerationQueue, WorldStartupLoadingFlames, WorldStartupOverlayState,
    WorldStartupSetupState, adjust_lod_for_integrated_gpu, draw_water_body_debug_overlay,
    log_mc_spike_build_tag, mesh_dirty_chunks_system, poll_chunk_generation_tasks,
    poll_world_load_task, spawn_queued_chunk_generation_tasks, spawn_world_startup_overlay,
    start_pending_world_generation, start_voxel_world_after_overlay_frame,
    update_chunk_face_visibility_system, update_chunk_lod_system, update_terrain_material_lod,
    update_water_body_registry, update_water_material_lod, update_world_startup_background_cover,
    update_world_startup_overlay,
};

pub struct VoxelPlugin;

impl Plugin for VoxelPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins((
            ExtractComponentPlugin::<ChunkMesh>::default(),
            ExtractComponentPlugin::<WaterMesh>::default(),
            ExtractComponentPlugin::<WaterMeshDetail>::default(),
            TerrainHoleProbePlugin,
            SeamAuditPassPlugin,
            crate::voxel::pages::ClodPagesPlugin,
        ));

        let size_chunks = IVec3::new(
            DEFAULT_WORLD_CHUNKS_X,
            DEFAULT_WORLD_CHUNKS_Y,
            DEFAULT_WORLD_CHUNKS_Z,
        );

        app.insert_resource(WorldConfig {
            size_chunks,
            chunk_size: 16,
            greedy_meshing: true,
        })
        .insert_resource(WorldBounds::from_size_chunks(size_chunks))
        .insert_resource(VoxelWorld::new(size_chunks))
        .insert_resource(ProceduralWorldSource::load_or_default())
        .insert_resource(MeshSettings {
            mode: MeshMode::SurfaceNets,
            ..default()
        })
        .insert_resource(LodSettings::default())
        .insert_resource(crate::voxel::terrain_debug::TerrainDebugView::default())
        .insert_resource(crate::voxel::terrain_debug::TerrainProbeNotice::default())
        .insert_resource(McTransvoxelSettings::load_or_default())
        .insert_resource(McTransvoxelRuntimeStats::default())
        .insert_resource(TerrainLodControl::default())
        .insert_resource(TerrainLodTransitionState::default())
        .insert_resource(LodMeshTransactionState::default())
        .insert_resource(MeshDirtyQueueWarningState::default())
        .insert_resource(RuntimeChunkStats::default())
        .insert_resource(WaterBodyRegistry::default())
        .insert_resource(ChunkGenerationState::default())
        .insert_resource(WorldStartupOverlayState::default())
        .insert_resource(WorldStartupLoadingFlames::default())
        .insert_resource(WorldStartupSetupState::default())
        .insert_resource(PendingWorldGeneration::default())
        .insert_resource(WorldGenerationQueue::default())
        .insert_resource(WorldPersistence {
            force_regenerate: false,
            ..default()
        })
        .insert_resource(VisibleChunks::default())
        .insert_resource(EnclosureState::default())
        .insert_resource(EnclosureOcclusionStats::default())
        .insert_resource(OcclusionConfig::load_or_default())
        .insert_resource(OcclusionUpdateTimer::default())
        .configure_sets(
            Update,
            (
                VoxelTerrainSet::GeneratedChunks,
                VoxelTerrainSet::NaadfDirtyQueue,
                VoxelTerrainSet::MeshDirty,
            )
                .chain(),
        )
        .add_systems(Startup, spawn_world_startup_overlay)
        .add_systems(Startup, log_mc_spike_build_tag)
        .add_systems(
            Update,
            start_voxel_world_after_overlay_frame.before(poll_world_load_task),
        )
        .add_systems(
            Update,
            (
                poll_world_load_task,
                start_pending_world_generation.after(poll_world_load_task),
                spawn_queued_chunk_generation_tasks.after(start_pending_world_generation),
                poll_chunk_generation_tasks
                    .after(spawn_queued_chunk_generation_tasks)
                    .in_set(VoxelTerrainSet::GeneratedChunks),
                update_enclosure_state.after(poll_chunk_generation_tasks),
                toggle_enclosure_culling,
                update_chunk_face_visibility_system.after(update_enclosure_state),
                adjust_lod_for_integrated_gpu.after(poll_chunk_generation_tasks),
                update_visible_chunks_system.after(update_chunk_face_visibility_system),
                apply_visibility_culling_system.after(update_visible_chunks_system),
                update_chunk_lod_system
                    .after(apply_visibility_culling_system)
                    .after(adjust_lod_for_integrated_gpu),
                mesh_dirty_chunks_system
                    .after(update_chunk_lod_system)
                    .in_set(VoxelTerrainSet::MeshDirty),
            ),
        )
        .add_systems(
            Update,
            (
                update_water_body_registry.after(mesh_dirty_chunks_system),
                update_water_material_lod.after(update_water_body_registry),
                draw_water_body_debug_overlay.after(update_water_body_registry),
                update_terrain_material_lod.after(update_chunk_lod_system),
                crate::voxel::terrain_iso_band::update_terrain_iso_band_volume
                    .after(update_terrain_material_lod),
                record_voxel_edit_counters,
                update_world_startup_background_cover,
                update_world_startup_overlay.after(mesh_dirty_chunks_system),
            ),
        );
    }
}

fn record_voxel_edit_counters(
    world: Res<VoxelWorld>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let stats = world.edit_stats();
    timing.record_count(frame.0, "Voxel Edits Applied", stats.applied as f64);
    timing.record_count(
        frame.0,
        "Voxel Edits Rejected Below Floor",
        stats.rejected_below_floor as f64,
    );
    timing.record_count(
        frame.0,
        "Voxel Edits Rejected Bedrock",
        stats.rejected_unbreakable as f64,
    );
    timing.record_count(
        frame.0,
        "Voxel Edits Rejected Out Of Bounds",
        stats.rejected_out_of_bounds as f64,
    );
}
