#![allow(unused_imports)]

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Instant;

use avian3d::prelude::{Collider, CollisionLayers, CollisionMargin, RigidBody};
use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::RenderLayers;
use bevy::diagnostic::FrameCount;
use bevy::ecs::system::SystemParam;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};
use bevy::window::PrimaryWindow;
use bevy_water::water::material::StandardWaterMaterial;

use crate::bench::{BenchForensicsConfig, BenchRenderToggles};
use crate::camera::controller::PlayerCamera;
use crate::constants::{
    BEACH_HEIGHT_OFFSET, BEDROCK_DEPTH, CHUNK_SIZE, CHUNK_SIZE_F32, CHUNK_SIZE_I32, CHUNK_VOLUME,
    DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z,
    INTEGRATED_GPU_CULL_DISTANCE, INTEGRATED_GPU_HIGH_DETAIL_DISTANCE, TREE_LEAF_CHECK_RADIUS,
    TREE_LEAF_RADIUS, WATER_FANCY_DISTANCE, WATER_FANCY_HYSTERESIS, WATER_FANCY_MIN_DEPTH,
    WATER_FANCY_MIN_TRIANGLES, WATER_LEVEL, WATER_MATERIAL_UPDATE_INTERVAL,
};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::physics::{
    ChunkCollider, NeedsCollider, PhysicsLayer, TerrainColliderBakeTask, TerrainCollisionChunk,
    TerrainCollisionState,
};
use crate::rendering::AmbientOcclusionConfig;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::materials::{VoxelMaterial, WaterMaterial};
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle,
};
use crate::rendering::water::WaterConfig;
use crate::rendering::water_reflection::{REFLECTION_RENDER_LAYER, WATER_MASK_RENDER_LAYER};
use crate::voxel::chunk::{Chunk, ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::enclosure::{
    EnclosureOcclusionStats, EnclosureState, toggle_enclosure_culling, update_enclosure_state,
};
use crate::voxel::lod::{
    LodSettings, build_terrain_neighbor_lods, chunk_contains_liquid,
    chunk_layer_intersects_waterline, collect_water_shore_lod_guard_chunks,
    effective_terrain_mesh_lod_for_chunk, forensics_mesh_mode_override, is_horizon_proxy_lod,
    resolve_terrain_mesh_mode, should_defer_surface_nets_mesh, target_terrain_mesh_mode_for_lod,
    terrain_lod_distance_xz, terrain_lod_requires_collider, terrain_material_quality_for_lod,
};
use crate::voxel::mc_transvoxel::{
    McTransvoxelLodDeltaPolicy, McTransvoxelRuntimeStats, McTransvoxelSettings,
    log_transition_stats_if_due,
};
use crate::voxel::mesh_commit::{
    LodMeshTransactionAbortReason, LodMeshTransactionFrameStats, LodMeshTransactionState,
    MAX_LOD_TRANSACTION_CHUNKS_PER_FRAME, MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME,
    PreparedLodChunkCommit, WaterChunkDepthDetail, compute_water_chunk_depth_detail,
    discard_lod_mesh_transaction, lod_transaction_abort_reason_count, mesh_forensics_options,
    process_lod_mesh_transaction,
};
use crate::voxel::meshing::{
    ChunkMesh, McTriangleSources, MeshGenerationTimingStats, MeshMode, MeshRequest, MeshSettings,
    TerrainMeshDebug, WaterBodyId, WaterBodyKind, WaterBodyMaterialMode, WaterMesh,
    WaterMeshDetail, count_missing_in_bounds_boundary_neighbors,
    empty_chunk_has_surface_nets_boundary_surface, generate_chunk_mesh_for_request,
    lod_delta_gt_one_face_mask,
};
use crate::voxel::occlusion::{
    OcclusionConfig, OcclusionUpdateTimer, VisibleChunks, update_visible_chunks_system,
};
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::terrain::{
    Biome, BiomeTable, TerrainGenerator, ValueNoise, WaterGenerationMetadata,
};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::visibility::compute_face_visibility;
use crate::voxel::world::{VoxelSample, VoxelWorld, WorldBounds};

fn env_flag(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

pub(crate) const MAX_CHUNKS_PER_FRAME: usize = 4;
pub(crate) const MAX_STARTUP_CHUNKS_PER_FRAME: usize = 12;
const MAX_DIRTY_CHUNKS_VISITED_PER_FRAME: usize = 64;
const MAX_DIRTY_CHUNKS_VISITED_WITH_DEFERRED_PER_FRAME: usize = 512;
const MESH_DIRTY_QUEUE_WARN_THRESHOLD: usize = 96;
const MESH_DIRTY_QUEUE_WARN_INTERVAL_SECS: f32 = 1.0;
const MAX_LOD_CHANGES_PER_UPDATE: usize = 32;
const LOD_CHANGE_COOLDOWN_FRAMES: u32 = 30;
const TERRAIN_MATERIAL_UPDATE_INTERVAL: f32 = 0.5;
const WATER_BODY_UPDATE_INTERVAL: f32 = 0.5;
const WATER_BODY_POND_MAX_AREA: f32 = 128.0;
const WATER_BODY_LAKE_MIN_AREA: f32 = 128.0;
const WATER_BODY_OCEAN_MIN_AREA: f32 = 4096.0;
const WATER_BODY_RIVER_ASPECT_RATIO: f32 = 4.0;
const WATER_BODY_LAKE_MIN_DEPTH: usize = 3;
const WATER_BODY_LAKE_MIN_AVG_DEPTH: f32 = 1.5;
const WATER_BODY_SHALLOW_FLOOD_MAX_DEPTH: usize = 1;
const WATER_BODY_SHALLOW_FLOOD_MAX_AVG_DEPTH: f32 = 1.25;
const WORLD_STARTUP_READY_HOLD_SECONDS: f32 = 1.0;
const WORLD_STARTUP_BACKGROUND_ZOOM: f32 = 1.12;
const WORLD_STARTUP_SETUP_DELAY_FRAMES: u8 = 1;
const WORLD_GENERATION_TASK_SPAWN_BATCH: usize = 192;

pub(crate) mod config;
pub(crate) mod generation;
pub(crate) mod mesh_scheduler;
pub(crate) mod startup_overlay;
pub(crate) mod stats;
pub(crate) mod visibility;
pub(crate) mod water_bodies;

pub(crate) use config::TerrainLodTransitionState;
pub use config::{TerrainLodControl, VoxelTerrainSet, WorldConfig};
pub use generation::ChunkGenerationState;
pub(crate) use generation::{
    PendingWorldGeneration, WorldGenerationQueue, WorldStats, assign_initial_lods_for_loaded_world,
    begin_world_generation, expected_world_chunk_count, generate_chunk_async,
    initial_lod_for_chunk, mark_surface_nets_halo_dirty, poll_chunk_generation_tasks,
    poll_world_load_task, should_poll_chunk_generation_tasks, spawn_queued_chunk_generation_tasks,
    start_pending_world_generation, start_voxel_world_after_overlay_frame,
};
pub(crate) use mesh_scheduler::{
    McSpikeMeshParams, MeshDirtyQueueWarningState, MeshDirtyReasonCounts,
    chunks_per_frame_limit_for_dirty_meshes, mesh_dirty_chunks_system,
    prioritize_dirty_chunks_for_camera, should_defer_runtime_chunk_stats_recompute,
    should_force_initial_runtime_chunk_stats, should_recompute_runtime_chunk_stats,
    terrain_material_quality_for_distance, update_terrain_material_lod,
};
pub(crate) use startup_overlay::{
    WorldStartupLoadingFlames, WorldStartupOverlayState, WorldStartupSetupState, WorldStartupStage,
    log_mc_spike_build_tag, spawn_world_startup_overlay, update_world_startup_background_cover,
    update_world_startup_overlay, world_startup_background_cover_size, world_startup_snapshot,
};
pub use stats::RuntimeChunkStats;
pub use visibility::apply_visibility_culling_system;
pub(crate) use visibility::{
    adjust_lod_for_integrated_gpu, update_chunk_face_visibility_system, update_chunk_lod_system,
};
pub use water_bodies::{WaterBodyInfo, WaterBodyRegistry};
pub(crate) use water_bodies::{
    WaterMaskProxy, WaterMeshBodySample, build_water_body_group, desired_water_visibility,
    draw_water_body_debug_overlay, update_water_body_registry, update_water_material_lod,
    water_body_edge_bit, water_body_material_mode,
};
