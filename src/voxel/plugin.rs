//! Voxel world plugin for chunk management and terrain generation.
//!
//! This module provides the core voxel functionality including:
//! - Procedural terrain generation with biomes, caves, dungeons, and trees
//! - Chunk-based world management with LOD (Level of Detail)
//! - Mesh generation and update systems
//! - Async chunk generation using Bevy's task pool

#[cfg(test)]
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::sync::Arc;

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponentPlugin;

#[cfg(test)]
use crate::constants::{
    CHUNK_SIZE, CHUNK_SIZE_I32, WATER_FANCY_DISTANCE, WATER_FANCY_MIN_TRIANGLES, WATER_LEVEL,
};
use crate::constants::{DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z};
use crate::performance::AreaTimingRecorder;

#[cfg(test)]
use crate::rendering::quality::RenderQualityPreset;
#[cfg(test)]
use crate::rendering::triplanar_material::TerrainMaterialQuality;
#[cfg(test)]
use crate::voxel::chunk::{Chunk, LodLevel, MeshDirtyReason};
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
#[cfg(test)]
use crate::voxel::mesh_commit::MAX_LOD_TRANSACTION_CHUNKS_PER_FRAME;
use crate::voxel::meshing::{ChunkMesh, MeshMode, MeshSettings, WaterMesh, WaterMeshDetail};
#[cfg(test)]
use crate::voxel::meshing::{WaterBodyKind, WaterBodyMaterialMode};
use crate::voxel::occlusion::{
    OcclusionConfig, OcclusionUpdateTimer, VisibleChunks, update_visible_chunks_system,
};
use crate::voxel::persistence::WorldPersistence;
#[cfg(test)]
use crate::voxel::terrain::TerrainGenerator;
use crate::voxel::world::{VoxelWorld, WorldBounds};
use crate::world::source::ProceduralWorldSource;

pub use crate::voxel::runtime::{
    ChunkGenerationState, RuntimeChunkStats, TerrainLodControl, VoxelTerrainSet, WaterBodyInfo,
    WaterBodyRegistry, WorldConfig, apply_visibility_culling_system,
};
#[cfg(test)]
use crate::voxel::runtime::{MAX_CHUNKS_PER_FRAME, MAX_STARTUP_CHUNKS_PER_FRAME};
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
#[cfg(test)]
use crate::voxel::runtime::{
    MeshDirtyReasonCounts, WaterMeshBodySample, WorldStartupStage, WorldStats,
    build_water_body_group, chunks_per_frame_limit_for_dirty_meshes, desired_water_visibility,
    expected_world_chunk_count, generate_chunk_async, initial_lod_for_chunk,
    mark_surface_nets_halo_dirty, prioritize_dirty_chunks_for_camera,
    should_defer_runtime_chunk_stats_recompute, should_force_initial_runtime_chunk_stats,
    should_poll_chunk_generation_tasks, should_recompute_runtime_chunk_stats,
    terrain_material_quality_for_distance, water_body_edge_bit, water_body_material_mode,
    world_startup_background_cover_size, world_startup_snapshot,
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
        // Use SurfaceNets for smooth terrain meshing (change to Blocky for Minecraft-style)
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
        // Runtime chunk statistics for debug overlay
        .insert_resource(RuntimeChunkStats::default())
        .insert_resource(WaterBodyRegistry::default())
        // Async chunk generation state
        .insert_resource(ChunkGenerationState::default())
        .insert_resource(WorldStartupOverlayState::default())
        .insert_resource(WorldStartupLoadingFlames::default())
        .insert_resource(WorldStartupSetupState::default())
        .insert_resource(PendingWorldGeneration::default())
        .insert_resource(WorldGenerationQueue::default())
        // World persistence settings (set force_regenerate to true to regenerate)
        .insert_resource(WorldPersistence {
            force_regenerate: false,
            ..default()
        })
        // Visibility optimization resources
        .insert_resource(VisibleChunks::default())
        .insert_resource(EnclosureState::default())
        .insert_resource(EnclosureOcclusionStats::default())
        // Enclosure detection activates this at runtime only when the player is indoors or underground.
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
                // Stage 1: Pull newly-generated chunks into VoxelWorld
                poll_chunk_generation_tasks
                    .after(spawn_queued_chunk_generation_tasks)
                    .in_set(VoxelTerrainSet::GeneratedChunks),
                update_enclosure_state.after(poll_chunk_generation_tasks),
                toggle_enclosure_culling,
                // Stage 2: Face visibility + GPU detection (independent resources, can be parallel)
                update_chunk_face_visibility_system.after(update_enclosure_state),
                adjust_lod_for_integrated_gpu.after(poll_chunk_generation_tasks),
                // Stage 3: BFS occlusion traversal
                update_visible_chunks_system.after(update_chunk_face_visibility_system),
                apply_visibility_culling_system.after(update_visible_chunks_system),
                // Stage 4: LOD per chunk (needs LodSettings from adjust + culling results)
                update_chunk_lod_system
                    .after(apply_visibility_culling_system)
                    .after(adjust_lod_for_integrated_gpu),
                // Stage 5: Meshing consumes all mesh-dirty producers above. Systems
                // that create mesh dirtiness later in Update must run before this or
                // intentionally leave their chunks queued for the next frame.
                mesh_dirty_chunks_system
                    .after(update_chunk_lod_system)
                    .in_set(VoxelTerrainSet::MeshDirty),
            ),
        )
        .add_systems(
            Update,
            (
                // Stage 5b: Water material LOD (independent of meshing, can be parallel)
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
        // .add_plugins(GravityPlugin); // Deactivated due to performance impact
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mesh_dirty_queue_warning_is_rate_limited_to_once_per_second() {
        let mut state = MeshDirtyQueueWarningState::default();

        assert!(state.should_warn(10.0));
        assert!(!state.should_warn(10.25));
        assert!(!state.should_warn(10.99));
        assert!(state.should_warn(11.0));
        assert!(!state.should_warn(11.5));
        assert!(state.should_warn(12.01));
    }

    #[test]
    fn water_material_visibility_restores_renderable_body_modes() {
        assert_eq!(
            desired_water_visibility(false, false, Some(WaterBodyMaterialMode::Hidden)),
            Visibility::Hidden
        );
        assert_eq!(
            desired_water_visibility(false, true, Some(WaterBodyMaterialMode::Fancy)),
            Visibility::Visible
        );
        assert_eq!(
            desired_water_visibility(false, true, Some(WaterBodyMaterialMode::Basic)),
            Visibility::Visible
        );
        assert_eq!(
            desired_water_visibility(false, true, None),
            Visibility::Visible
        );
    }

    #[test]
    fn water_body_edge_bit_mapping_is_stable() {
