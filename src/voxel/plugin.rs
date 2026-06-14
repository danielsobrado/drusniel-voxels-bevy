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
            desired_water_visibility(false, false, Some(WaterBodyMaterialMode::Fancy)),
            Visibility::Inherited
        );
        assert_eq!(
            desired_water_visibility(false, false, Some(WaterBodyMaterialMode::Cheap)),
            Visibility::Inherited
        );
        assert_eq!(
            desired_water_visibility(false, false, Some(WaterBodyMaterialMode::Unknown)),
            Visibility::Inherited
        );
        assert_eq!(
            desired_water_visibility(false, false, None),
            Visibility::Inherited
        );
    }

    #[test]
    fn forced_water_material_modes_override_hidden_visibility() {
        assert_eq!(
            desired_water_visibility(true, false, Some(WaterBodyMaterialMode::Hidden)),
            Visibility::Inherited
        );
        assert_eq!(
            desired_water_visibility(false, true, Some(WaterBodyMaterialMode::Hidden)),
            Visibility::Inherited
        );
    }

    #[test]
    fn shallow_flood_water_uses_fancy_material_when_near() {
        assert_eq!(
            water_body_material_mode(
                WaterBodyMaterialMode::Unknown,
                WATER_FANCY_DISTANCE - 1.0,
                1,
                WATER_FANCY_MIN_TRIANGLES as f32,
                WaterBodyKind::ShallowFlood,
            ),
            WaterBodyMaterialMode::Fancy
        );
    }

    #[test]
    fn initial_lod_assignment_uses_lod0_without_lod_dirty_reason() {
        let mut chunk = Chunk::new(IVec3::new(18, 0, 0));
        let initial_lod = initial_lod_for_chunk();

        assert_eq!(initial_lod, LodLevel::Lod0);
        chunk.set_initial_lod_level(initial_lod);

        assert_eq!(chunk.lod_level(), initial_lod);
        assert!(chunk.has_dirty_reason(MeshDirtyReason::Generation));
        assert!(!chunk.has_dirty_reason(MeshDirtyReason::Lod));
    }

    #[test]
    fn initial_lod_assignment_uses_lod0_when_pages_own_far_field() {
        let initial_lod = initial_lod_for_chunk();

        assert_eq!(initial_lod, LodLevel::Lod0);
    }

    #[test]
    fn generated_chunk_marks_face_neighbors_dirty() {
        let center = IVec3::new(1, 1, 1);
        let mut world = VoxelWorld::new(IVec3::new(3, 3, 3));

        for z in 0..3 {
            for y in 0..3 {
                for x in 0..3 {
                    let mut chunk = Chunk::new(IVec3::new(x, y, z));
                    chunk.clear_dirty();
                    world.insert_chunk(chunk);
                }
            }
        }

        mark_surface_nets_halo_dirty(&mut world, center);

        let dirty = world.dirty_chunks().collect::<HashSet<_>>();
        assert_eq!(dirty.len(), 6);
        assert!(!dirty.contains(&center));
        assert!(dirty.contains(&(center + IVec3::X)));
        assert!(dirty.contains(&(center + IVec3::NEG_Y)));
        assert!(!dirty.contains(&(center + IVec3::new(-1, -1, -1))));
    }

    #[test]
    fn world_startup_snapshot_reports_generation_progress() {
        let gen_state = ChunkGenerationState {
            total_chunks: 100,
            chunks_completed: 25,
            is_complete: false,
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: None,
        };
        let chunk_stats = RuntimeChunkStats::default();

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, true, None);

        assert_eq!(snapshot.stage, WorldStartupStage::GeneratingTerrain);
        assert_eq!(snapshot.progress, 0.225);
        assert!(snapshot.detail.contains("25 of 100"));
        assert!(!snapshot.complete);
    }

    #[test]
    fn world_startup_snapshot_keeps_loaded_world_visible_until_meshed() {
        let gen_state = ChunkGenerationState {
            total_chunks: 100,
            chunks_completed: 100,
            is_complete: true,
            loading_from_disk: true,
            world_stats: WorldStats::default(),
            start_time: None,
        };
        let mut chunk_stats = RuntimeChunkStats::default();

        let preparing = world_startup_snapshot(&gen_state, &chunk_stats, true, None);
        assert_eq!(preparing.stage, WorldStartupStage::PreparingMeshes);
        assert!(!preparing.complete);

        chunk_stats.mesh_entities = 1;
        let ready = world_startup_snapshot(&gen_state, &chunk_stats, true, None);
        assert_eq!(ready.stage, WorldStartupStage::Ready);
        assert!(ready.complete);
    }

    #[test]
    fn world_startup_snapshot_waits_for_deferred_surface_nets_halo() {
        let gen_state = ChunkGenerationState {
            total_chunks: 100,
            chunks_completed: 100,
            is_complete: true,
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: None,
        };
        let chunk_stats = RuntimeChunkStats {
            mesh_entities: 10,
            dirty_chunks_queued: 2,
            surface_nets_chunks_deferred_for_halo: 1,
            ..Default::default()
        };

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, true, None);

        assert_eq!(snapshot.stage, WorldStartupStage::PreparingMeshes);
        assert!(snapshot.detail.contains("waiting for neighbors"));
        assert!(!snapshot.complete);
    }

    #[test]
    fn world_startup_snapshot_does_not_wait_for_idle_lod_dirty_queue() {
        let gen_state = ChunkGenerationState {
            total_chunks: 100,
            chunks_completed: 100,
            is_complete: true,
            loading_from_disk: true,
            world_stats: WorldStats::default(),
            start_time: None,
        };
        let chunk_stats = RuntimeChunkStats {
            mesh_entities: 10,
            dirty_chunks_queued: 300,
            ..Default::default()
        };

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, true, None);

        assert_eq!(snapshot.stage, WorldStartupStage::Ready);
        assert!(snapshot.complete);
    }

    #[test]
    fn world_startup_snapshot_gate_waits_for_pages_and_live_queue() {
        let gen_state = ChunkGenerationState {
            total_chunks: 100,
            chunks_completed: 100,
            is_complete: true,
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: None,
        };
        let mut chunk_stats = RuntimeChunkStats {
            mesh_entities: 10,
            ..Default::default()
        };
        let mut gate = crate::voxel::pages::ClodPageMeshGate::default();
        gate.pages_ready = false;
        gate.pages_pending = true;

        let waiting_pages = world_startup_snapshot(&gen_state, &chunk_stats, true, Some(&gate));
        assert_eq!(waiting_pages.stage, WorldStartupStage::PreparingMeshes);
        assert!(waiting_pages.detail.contains("terrain pages"));

        gate.pages_pending = false;
        let missing_fallback = world_startup_snapshot(&gen_state, &chunk_stats, true, Some(&gate));
        assert_eq!(missing_fallback.stage, WorldStartupStage::Ready);
        assert!(missing_fallback.complete);

        gate.pages_failed = true;
        let failed_fallback = world_startup_snapshot(&gen_state, &chunk_stats, true, Some(&gate));
        assert_eq!(failed_fallback.stage, WorldStartupStage::Ready);
        assert!(failed_fallback.complete);

        gate.pages_failed = false;
        gate.pages_ready = true;
        chunk_stats.dirty_chunks_queued = 2;
        let waiting_live = world_startup_snapshot(&gen_state, &chunk_stats, true, Some(&gate));
        assert_eq!(waiting_live.stage, WorldStartupStage::PreparingMeshes);
        assert!(waiting_live.detail.contains("live terrain meshes"));

        chunk_stats.dirty_chunks_queued = 0;
        let ready = world_startup_snapshot(&gen_state, &chunk_stats, true, Some(&gate));
        assert_eq!(ready.stage, WorldStartupStage::Ready);
        assert!(ready.complete);
    }

    #[test]
    fn world_startup_snapshot_waits_for_overlay_before_generation() {
        let gen_state = ChunkGenerationState::default();
        let chunk_stats = RuntimeChunkStats::default();

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, false, None);

        assert_eq!(snapshot.stage, WorldStartupStage::LoadingSavedWorld);
        assert!(snapshot.detail.contains("Starting world load"));
        assert!(!snapshot.complete);
    }

    #[test]
    fn chunk_generation_polling_waits_while_saved_world_is_loading() {
        let gen_state = ChunkGenerationState {
            total_chunks: 0,
            chunks_completed: 0,
            is_complete: false,
            loading_from_disk: true,
            world_stats: WorldStats::default(),
            start_time: Some(std::time::Instant::now()),
        };

        assert!(!should_poll_chunk_generation_tasks(&gen_state));
    }

    #[test]
    fn chunk_generation_polling_does_not_complete_empty_startup_state() {
        let gen_state = ChunkGenerationState {
            total_chunks: 0,
            chunks_completed: 0,
            is_complete: false,
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: Some(std::time::Instant::now()),
        };

        assert!(!should_poll_chunk_generation_tasks(&gen_state));
    }

    #[test]
    fn chunk_generation_polling_runs_for_queued_generation() {
        let gen_state = ChunkGenerationState {
            total_chunks: 100,
            chunks_completed: 25,
            is_complete: false,
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: Some(std::time::Instant::now()),
        };

        assert!(should_poll_chunk_generation_tasks(&gen_state));
    }

    #[test]
    fn world_generation_queue_batches_startup_task_spawns() {
        let mut queue = WorldGenerationQueue::default();
        queue.begin(
            vec![
                IVec3::new(0, 0, 0),
                IVec3::new(1, 0, 0),
                IVec3::new(2, 0, 0),
                IVec3::new(3, 0, 0),
                IVec3::new(4, 0, 0),
            ],
            Arc::new(TerrainGenerator::default()),
        );

        let (first_batch, _, first_complete) = queue.take_next_batch(2).expect("first batch");
        assert_eq!(first_batch, vec![IVec3::new(0, 0, 0), IVec3::new(1, 0, 0)]);
        assert!(!first_complete);
        assert_eq!(queue.remaining(), 3);

        let (second_batch, _, second_complete) = queue.take_next_batch(8).expect("second batch");
        assert_eq!(
            second_batch,
            vec![
                IVec3::new(2, 0, 0),
                IVec3::new(3, 0, 0),
                IVec3::new(4, 0, 0)
            ]
        );
        assert!(second_complete);
        assert_eq!(queue.remaining(), 0);
        assert!(queue.take_next_batch(2).is_none());
    }

    #[test]
    fn startup_background_cover_size_preserves_aspect_and_overfills_window() {
        let draw_size = world_startup_background_cover_size(
            Vec2::new(1920.0, 1080.0),
            Vec2::new(1024.0, 1024.0),
            1.1,
        )
        .expect("cover size");

        assert!(draw_size.x >= 1920.0);
        assert!(draw_size.y >= 1080.0);
        assert!((draw_size.x / draw_size.y - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn expected_world_chunk_count_rejects_invalid_sizes() {
        assert_eq!(expected_world_chunk_count(IVec3::new(32, 6, 32)), 6144);
        assert_eq!(expected_world_chunk_count(IVec3::new(0, 6, 32)), 0);
        assert_eq!(expected_world_chunk_count(IVec3::new(32, -1, 32)), 0);
    }

    #[test]
    fn dirty_chunk_priority_sorts_only_nearest_visit_window() {
        let mut dirty_chunks = vec![
            IVec3::new(10, 0, 0),
            IVec3::new(2, 0, 0),
            IVec3::new(0, 0, 0),
            IVec3::new(1, 0, 0),
        ];

        let sort_window =
            prioritize_dirty_chunks_for_camera(&mut dirty_chunks, Some(Vec3::ZERO), 2);

        assert_eq!(sort_window, 2);
        assert_eq!(dirty_chunks[0], IVec3::new(0, 0, 0));
        assert_eq!(dirty_chunks[1], IVec3::new(1, 0, 0));
    }

    #[test]
    fn runtime_chunk_stats_recompute_continues_after_dirty_queue_drains() {
        assert!(should_recompute_runtime_chunk_stats(30));
        assert!(!should_recompute_runtime_chunk_stats(31));

        assert!(!should_defer_runtime_chunk_stats_recompute(false, 100, 4));
        assert!(!should_defer_runtime_chunk_stats_recompute(true, 4, 4));
        assert!(should_defer_runtime_chunk_stats_recompute(true, 5, 4));
    }

    #[test]
    fn runtime_chunk_stats_force_an_initial_snapshot_for_loaded_worlds() {
        assert!(should_force_initial_runtime_chunk_stats(0, 6144));
        assert!(!should_force_initial_runtime_chunk_stats(6144, 6144));
        assert!(!should_force_initial_runtime_chunk_stats(0, 0));
    }

    #[test]
    fn generation_dirty_meshes_use_startup_burst() {
        let reason_counts = MeshDirtyReasonCounts {
            generation: 8,
            ..Default::default()
        };

        assert_eq!(
            chunks_per_frame_limit_for_dirty_meshes(&reason_counts, false, true),
            MAX_STARTUP_CHUNKS_PER_FRAME
        );
    }

    #[test]
    fn generation_dirty_meshes_keep_runtime_limit_before_generation_completes() {
        let reason_counts = MeshDirtyReasonCounts {
            generation: 8,
            ..Default::default()
        };

        assert_eq!(
            chunks_per_frame_limit_for_dirty_meshes(&reason_counts, false, false),
            MAX_CHUNKS_PER_FRAME
        );
    }

    #[test]
    fn terrain_mutation_dirty_meshes_keep_runtime_limit() {
        let reason_counts = MeshDirtyReasonCounts {
            generation: 8,
            terrain_mutation: 1,
            ..Default::default()
        };

        assert_eq!(
            chunks_per_frame_limit_for_dirty_meshes(&reason_counts, false, true),
            MAX_CHUNKS_PER_FRAME
        );
    }

    #[test]
    fn lod_churn_dirty_meshes_keep_lod_limit() {
        let reason_counts = MeshDirtyReasonCounts {
            lod: 8,
            ..Default::default()
        };

        assert_eq!(
            chunks_per_frame_limit_for_dirty_meshes(&reason_counts, true, true),
            MAX_LOD_TRANSACTION_CHUNKS_PER_FRAME
        );
    }

    #[test]
    fn water_body_edge_masks_track_chunk_edge_cells() {
        let west_edge = water_body_edge_bit(0) | water_body_edge_bit(3);
        let east_edge = water_body_edge_bit(3) | water_body_edge_bit(CHUNK_SIZE_I32 - 1);

        assert_ne!(west_edge & east_edge, 0);
        assert_eq!(west_edge & water_body_edge_bit(2), 0);
        assert_eq!(water_body_edge_bit(-1), 0);
        assert_eq!(water_body_edge_bit(CHUNK_SIZE_I32), 0);
    }

    #[test]
    fn water_body_distance_uses_nearest_chunk_not_union_aabb() {
        let world = VoxelWorld::new(IVec3::new(32, 6, 32));
        let sample = |chunk_pos: IVec3, aabb_min: Vec3, aabb_max: Vec3| WaterMeshBodySample {
            entity: Entity::from_bits(1),
            chunk_pos,
            surface_y: WATER_LEVEL,
            surface_area: 256.0,
            max_depth: 8,
            average_depth: 8.0,
            aabb_min,
            aabb_max,
            touches_world_edge: true,
            view_visible: true,
            edge_north: 0,
            edge_south: 0,
            edge_west: 0,
            edge_east: 0,
        };
        let samples = [
            sample(
                IVec3::new(0, 1, 0),
                Vec3::new(0.0, WATER_LEVEL as f32, 0.0),
                Vec3::new(16.0, WATER_LEVEL as f32 + 1.0, 16.0),
            ),
            sample(
                IVec3::new(31, 1, 31),
                Vec3::new(496.0, WATER_LEVEL as f32, 496.0),
                Vec3::new(512.0, WATER_LEVEL as f32 + 1.0, 512.0),
            ),
        ];

        let group = build_water_body_group(
            &[0, 1],
            &samples,
            &world,
            Some(Vec3::new(256.0, WATER_LEVEL as f32, 256.0)),
            &HashMap::new(),
        );

        assert!(group.nearest_distance > WATER_FANCY_DISTANCE);
        assert_eq!(group.material_mode, WaterBodyMaterialMode::Cheap);
    }

    #[test]
    fn live_terrain_material_stays_full_triplanar_by_distance() {
        assert_eq!(
            terrain_material_quality_for_lod(LodLevel::Lod1, None),
            TerrainMaterialQuality::FullTriplanar
        );
        assert_eq!(
            terrain_material_quality_for_distance(
                10_000.0,
                TerrainMaterialQuality::FullTriplanar,
                None,
                RenderQualityPreset::High,
            ),
            TerrainMaterialQuality::FullTriplanar
        );
    }

    #[test]
    fn generated_chunk_matches_single_voxel_generator_for_sample_chunks() {
        let generator = TerrainGenerator::default();
        let mut chunk_positions = vec![IVec3::new(0, 0, 0)];

        'find_tree: for z in 0..128 {
            for x in 0..128 {
                let terrain_height = generator.get_height(x, z);
                if generator.should_spawn_tree(x, z, terrain_height) {
                    chunk_positions.push(IVec3::new(
                        x.div_euclid(CHUNK_SIZE_I32),
                        (terrain_height + 1).div_euclid(CHUNK_SIZE_I32),
                        z.div_euclid(CHUNK_SIZE_I32),
                    ));
                    break 'find_tree;
                }
            }
        }

        for chunk_pos in chunk_positions {
            let (chunk, _) = generate_chunk_async(chunk_pos, &generator);
            let chunk_world = chunk_pos * CHUNK_SIZE_I32;

            for z in 0..CHUNK_SIZE {
                for y in 0..CHUNK_SIZE {
                    for x in 0..CHUNK_SIZE {
                        let world_x = chunk_world.x + x as i32;
                        let world_y = chunk_world.y + y as i32;
                        let world_z = chunk_world.z + z as i32;
                        assert_eq!(
                            chunk.get(UVec3::new(x as u32, y as u32, z as u32)),
                            generator.get_voxel(world_x, world_y, world_z),
                            "voxel mismatch at world ({world_x}, {world_y}, {world_z}) in chunk {chunk_pos:?}"
                        );
                    }
                }
            }
        }
    }
}
