//! Voxel world plugin for chunk management and terrain generation.
//!
//! This module provides the core voxel functionality including:
//! - Procedural terrain generation with biomes, caves, dungeons, and trees
//! - Chunk-based world management with LOD (Level of Detail)
//! - Mesh generation and update systems
//! - Async chunk generation using Bevy's task pool

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Instant;

use bevy::diagnostic::FrameCount;
use bevy::ecs::system::SystemParam;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponentPlugin;
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};
use bevy::window::PrimaryWindow;

use crate::bench::{
    BenchForensicsConfig, BenchForensicsMcTransitions, BenchForensicsTerrainLod,
    BenchForensicsTerrainMesher, BenchRenderToggles,
};
use crate::camera::controller::PlayerCamera;
use crate::constants::{
    BEACH_HEIGHT_OFFSET,
    BEDROCK_DEPTH,
    CHUNK_SIZE,
    CHUNK_SIZE_F32,
    CHUNK_SIZE_I32,
    CHUNK_VOLUME,
    DEFAULT_CULL_DISTANCE,
    // LOD
    DEFAULT_HIGH_DETAIL_DISTANCE,
    DEFAULT_WORLD_CHUNKS_X,
    DEFAULT_WORLD_CHUNKS_Y,
    DEFAULT_WORLD_CHUNKS_Z,
    INTEGRATED_GPU_CULL_DISTANCE,
    INTEGRATED_GPU_HIGH_DETAIL_DISTANCE,
    LOD_HYSTERESIS,
    TREE_LEAF_CHECK_RADIUS,
    TREE_LEAF_RADIUS,
    WATER_FANCY_DISTANCE,
    WATER_FANCY_HYSTERESIS,
    WATER_FANCY_MIN_DEPTH,
    WATER_FANCY_MIN_TRIANGLES,
    WATER_MATERIAL_UPDATE_INTERVAL,
};
use crate::performance::{AreaTimingRecorder, area_timer};

/// Maximum number of chunks to mesh per frame to prevent frame spikes.
/// This throttles mesh generation during heavy updates (e.g., initial load, LOD transitions).
const MAX_CHUNKS_PER_FRAME: usize = 4;
const MAX_STARTUP_CHUNKS_PER_FRAME: usize = 12;
const MAX_DIRTY_CHUNKS_VISITED_PER_FRAME: usize = 64;
const MAX_DIRTY_CHUNKS_VISITED_WITH_DEFERRED_PER_FRAME: usize = 512;
const MAX_LOD_DIRTY_CHUNKS_PER_FRAME: usize = 4;
// Raised from 4: at 4 changes/update the LOD backlog never drained, leaving
// scattered chunks stuck at a stale LOD (isolated islands that crack).
const MAX_LOD_CHANGES_PER_UPDATE: usize = 32;
const LOD_CHANGE_COOLDOWN_FRAMES: u32 = 30;
/// Fixpoint iterations for the LOD coherence pass that removes isolated
/// coarser-than-all-neighbours LOD islands.
const LOD_COHERENCE_PASSES: u32 = 4;
const TERRAIN_LOD_HYSTERESIS: f32 = LOD_HYSTERESIS * 2.0;
const TERRAIN_MATERIAL_LOD_DISTANCE: f32 = 96.0;
const TERRAIN_MATERIAL_LOD_HYSTERESIS: f32 = 16.0;
const TERRAIN_MATERIAL_UPDATE_INTERVAL: f32 = 0.5;
pub(crate) const WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA: f32 = 80.0;
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
use crate::constants::WATER_LEVEL;
use crate::physics::NeedsCollider;
use crate::rendering::AmbientOcclusionConfig;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::loading_flames::{LoadingFlamesMaterial, LoadingFlamesUniform};
use crate::rendering::materials::{VoxelMaterial, WaterMaterial};
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle,
};
use crate::rendering::water::WaterConfig;
use crate::rendering::water_reflection::{REFLECTION_RENDER_LAYER, WATER_MASK_RENDER_LAYER};
use crate::voxel::chunk::{Chunk, ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::enclosure::{
    EnclosureOcclusionStats, EnclosureState, sync_occlusion_config_from_enclosure,
    toggle_enclosure_culling, update_enclosure_state,
};
use crate::voxel::hole_probe::TerrainHoleProbePlugin;
use crate::voxel::mc_transvoxel::{
    McTransvoxelLodDeltaPolicy, McTransvoxelRuntimeStats, McTransvoxelSettings,
    log_transition_stats_if_due,
};
use crate::voxel::meshing::{
    ChunkMesh, McTransitionForensicsMode, McTriangleSources, MeshForensicsOptions, MeshMode,
    MeshSettings, TerrainMeshDebug, WaterBodyId, WaterBodyKind, WaterBodyMaterialMode, WaterMesh,
    WaterMeshDetail, count_missing_in_bounds_boundary_neighbors,
    empty_chunk_has_surface_nets_boundary_surface, generate_chunk_mesh_with_mode_and_forensics,
    lod_delta_gt_one_face_mask,
};
use crate::voxel::occlusion::{
    OcclusionConfig, OcclusionUpdateTimer, VisibleChunks, update_visible_chunks_system,
};
use crate::voxel::octree::ChunkOctree;
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::terrain::{Biome, TerrainGenerator, WaterGenerationMetadata};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::visibility::compute_face_visibility;
use crate::voxel::world::{VoxelSample, VoxelWorld, WorldBounds};
use bevy::camera::visibility::RenderLayers;
use bevy_ui_render::prelude::MaterialNode;
use bevy_water::water::material::StandardWaterMaterial;

fn env_flag(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

pub struct VoxelPlugin;

#[derive(SystemSet, Debug, Hash, PartialEq, Eq, Clone)]
pub enum VoxelTerrainSet {
    GeneratedChunks,
    NaadfDirtyQueue,
    MeshDirty,
}

#[derive(Resource, Default, Debug)]
pub struct TerrainLodControl {
    pub freeze_lod: bool,
}

#[derive(Resource, Default)]
struct TerrainLodTransitionState {
    last_change_frame: HashMap<IVec3, u32>,
    change_count: HashMap<IVec3, u32>,
    last_change_second: f32,
    changes_this_second: u32,
    changes_per_second: f32,
    repeated_chunks_this_frame: u32,
}

#[derive(Resource)]
pub struct WorldConfig {
    pub size_chunks: IVec3,
    pub chunk_size: i32,
    pub greedy_meshing: bool,
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct LodSettings {
    /// Distance in world units for high detail meshing (Surface Nets by default).
    pub high_detail_distance: f32,
    /// Distance in world units at which chunks are culled entirely.
    pub cull_distance: f32,
    /// Mesh mode to use for far chunks that are still visible.
    pub low_detail_mode: MeshMode,
}

impl Default for LodSettings {
    fn default() -> Self {
        Self {
            high_detail_distance: DEFAULT_HIGH_DETAIL_DISTANCE,
            cull_distance: DEFAULT_CULL_DISTANCE,
            // Use Surface Nets for low LOD too - eliminates harsh visual transition
            // between smooth terrain and blocky chunks at LOD boundaries
            low_detail_mode: MeshMode::SurfaceNets,
        }
    }
}

impl LodSettings {
    fn minimum_valid_cull_distance(high_detail_distance: f32) -> f32 {
        high_detail_distance + terrain_lod_hysteresis_for(high_detail_distance) * 4.0 + 1.0
    }

    fn has_valid_distance_bands(&self) -> bool {
        self.cull_distance
            > self.high_detail_distance
                + terrain_lod_hysteresis_for(self.high_detail_distance) * 4.0
    }

    pub fn clamp_distance_bands(&mut self) {
        let min_cull_distance = Self::minimum_valid_cull_distance(self.high_detail_distance);
        self.cull_distance = self.cull_distance.max(min_cull_distance);
    }
}

/// Runtime chunk statistics for debug overlay and performance monitoring.
///
/// This resource tracks chunk counts by uniformity type, mesh entities,
/// and per-frame statistics for the debug overlay (F3).
#[derive(Resource, Default, Debug)]
pub struct RuntimeChunkStats {
    // Total chunk counts by uniformity
    pub total_chunks: u32,
    pub empty_chunks: u32,
    pub solid_chunks: u32,
    pub mixed_chunks: u32,

    // Mesh statistics
    pub mesh_entities: u32,
    pub water_mesh_entities: u32,
    pub water_air_boundaries_total: u64,
    pub water_air_boundaries_exposed: u64,
    pub water_air_boundaries_sealed: u64,
    pub water_triangles_removed_sealed: u64,
    pub invalid_water_meshes_suppressed: u64,
    pub edge_water_faces_suppressed: u64,
    pub water_flood_fill_boundary_hits: u64,
    pub water_exposure_outside_world_rejected: u64,
    pub terrain_mesh_empty_but_solid_voxels: u64,
    pub terrain_mesh_boundary_missing_neighbor: u64,
    pub terrain_mesh_degenerate_triangles_removed: u64,
    pub terrain_mesh_lod_seam_repairs: u64,

    // Per-frame statistics (reset each frame in the meshing system)
    pub chunks_meshed_this_frame: u32,
    pub chunks_skipped_this_frame: u32,
    pub dirty_chunks_queued: u32,
    pub surface_nets_chunks_deferred_for_halo: u32,

    // LOD statistics
    pub high_lod_chunks: u32,
    pub low_lod_chunks: u32,
    pub culled_chunks: u32,

    // Vertex count statistics (for measuring LOD effectiveness)
    pub high_lod_vertices: u64,
    pub low_lod_vertices: u64,
    pub total_vertices: u64,

    // Chunk counts for averaging (how many chunks contributed to vertex counts)
    pub high_lod_mesh_count: u32,
    pub low_lod_mesh_count: u32,

    // Per-frame meshing time tracking (microseconds)
    pub meshing_time_us: u64,
}

impl RuntimeChunkStats {
    /// Recompute all statistics from the world state.
    pub fn recompute_from_world(&mut self, world: &VoxelWorld) {
        self.total_chunks = 0;
        self.empty_chunks = 0;
        self.solid_chunks = 0;
        self.mixed_chunks = 0;
        self.mesh_entities = 0;
        self.water_mesh_entities = 0;
        self.high_lod_chunks = 0;
        self.low_lod_chunks = 0;
        self.culled_chunks = 0;
        self.terrain_mesh_empty_but_solid_voxels = 0;
        self.terrain_mesh_boundary_missing_neighbor = 0;
        self.terrain_mesh_degenerate_triangles_removed = 0;
        self.terrain_mesh_lod_seam_repairs = 0;
        self.invalid_water_meshes_suppressed = 0;
        self.edge_water_faces_suppressed = 0;
        self.water_flood_fill_boundary_hits = 0;
        self.water_exposure_outside_world_rejected = 0;
        // Note: vertex counts are tracked during mesh generation, not here

        for (_, chunk) in world.chunk_entries() {
            self.total_chunks += 1;

            match chunk.uniformity() {
                ChunkUniformity::Empty => self.empty_chunks += 1,
                ChunkUniformity::Solid => self.solid_chunks += 1,
                ChunkUniformity::Mixed => self.mixed_chunks += 1,
                ChunkUniformity::Unknown => {} // Count as mixed for display purposes
            }

            if chunk.mesh_entity().is_some() {
                self.mesh_entities += 1;
            }
            if chunk.water_mesh_entity().is_some() {
                self.water_mesh_entities += 1;
            }

            match chunk.lod_level() {
                LodLevel::Lod0 => self.high_lod_chunks += 1,
                LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 => self.low_lod_chunks += 1,
                LodLevel::Culled => self.culled_chunks += 1,
            }
        }
    }

    /// Reset per-frame counters.
    pub fn reset_frame_counters(&mut self) {
        self.chunks_meshed_this_frame = 0;
        self.chunks_skipped_this_frame = 0;
        self.dirty_chunks_queued = 0;
        self.surface_nets_chunks_deferred_for_halo = 0;
        self.meshing_time_us = 0;
    }

    /// Reset vertex count statistics (called when recomputing all stats).
    pub fn reset_vertex_counts(&mut self) {
        self.high_lod_vertices = 0;
        self.low_lod_vertices = 0;
        self.total_vertices = 0;
        self.high_lod_mesh_count = 0;
        self.low_lod_mesh_count = 0;
    }

    /// Add vertex count for a mesh at a given LOD level.
    pub fn add_mesh_vertices(&mut self, vertex_count: u32, lod_level: LodLevel) {
        // Only count non-empty meshes for averaging
        if vertex_count == 0 {
            return;
        }
        let count = vertex_count as u64;
        self.total_vertices += count;
        match lod_level {
            LodLevel::Lod0 => {
                self.high_lod_vertices += count;
                self.high_lod_mesh_count += 1;
            }
            LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 => {
                self.low_lod_vertices += count;
                self.low_lod_mesh_count += 1;
            }
            LodLevel::Culled => {} // No vertices for culled chunks
        }
    }

    /// Get average vertices per chunk for high LOD meshes.
    pub fn avg_high_lod_vertices(&self) -> u32 {
        if self.high_lod_mesh_count > 0 {
            (self.high_lod_vertices / self.high_lod_mesh_count as u64) as u32
        } else {
            0
        }
    }

    /// Get average vertices per chunk for low LOD meshes.
    pub fn avg_low_lod_vertices(&self) -> u32 {
        if self.low_lod_mesh_count > 0 {
            (self.low_lod_vertices / self.low_lod_mesh_count as u64) as u32
        } else {
            0
        }
    }

    /// Get LOD reduction ratio (0.0 to 1.0, lower = more reduction).
    pub fn lod_reduction_ratio(&self) -> f32 {
        let hi_avg = self.avg_high_lod_vertices();
        let lo_avg = self.avg_low_lod_vertices();
        if hi_avg > 0 && lo_avg > 0 {
            lo_avg as f32 / hi_avg as f32
        } else {
            1.0 // No data, assume no reduction
        }
    }
}

#[derive(Clone, Debug)]
pub struct WaterBodyInfo {
    pub id: WaterBodyId,
    pub kind: WaterBodyKind,
    pub aabb_min: Vec3,
    pub aabb_max: Vec3,
    pub surface_y: f32,
    pub surface_area: f32,
    pub max_depth: usize,
    pub average_depth: f32,
    pub nearest_distance: f32,
    pub visible_chunks: u32,
    pub chunk_count: u32,
    pub material_mode: WaterBodyMaterialMode,
    pub reflection_strength: f32,
    pub fresnel_power: f32,
    pub distortion_strength: f32,
}

#[derive(Resource, Default, Debug)]
pub struct WaterBodyRegistry {
    pub bodies: HashMap<WaterBodyId, WaterBodyInfo>,
    pub total: u32,
    pub ocean: u32,
    pub lake: u32,
    pub river: u32,
    pub pond: u32,
    pub shallow_flood: u32,
    pub fancy_count: u32,
    pub cheap_count: u32,
    pub hidden_count: u32,
    pub material_switches: u32,
    pub chunks_forced_consistent: u32,
}

#[derive(Component)]
struct WaterMaskProxy;

impl WaterBodyRegistry {
    pub fn recount(&mut self) {
        self.reset_counts();
        let bodies = self.bodies.values().cloned().collect::<Vec<_>>();
        for body in &bodies {
            self.count_body(body);
        }
    }

    fn reset_counts(&mut self) {
        self.total = 0;
        self.ocean = 0;
        self.lake = 0;
        self.river = 0;
        self.pond = 0;
        self.shallow_flood = 0;
        self.fancy_count = 0;
        self.cheap_count = 0;
        self.hidden_count = 0;
        self.material_switches = 0;
        self.chunks_forced_consistent = 0;
    }

    fn count_body(&mut self, body: &WaterBodyInfo) {
        self.total += 1;
        match body.kind {
            WaterBodyKind::Ocean => self.ocean += 1,
            WaterBodyKind::Lake => self.lake += 1,
            WaterBodyKind::River => self.river += 1,
            WaterBodyKind::Pond => self.pond += 1,
            WaterBodyKind::ShallowFlood => self.shallow_flood += 1,
            WaterBodyKind::Unknown => {}
        }
        match body.material_mode {
            WaterBodyMaterialMode::Fancy => self.fancy_count += 1,
            WaterBodyMaterialMode::Cheap => self.cheap_count += 1,
            WaterBodyMaterialMode::Hidden => self.hidden_count += 1,
            WaterBodyMaterialMode::Unknown => {}
        }
    }
}

// =============================================================================
// Async Chunk Generation
// =============================================================================

/// Result of async chunk generation task.
struct ChunkGenerationResult {
    chunk: Chunk,
    stats: ChunkStats,
}

/// Tracks the state of async world generation.
#[derive(Resource)]
pub struct ChunkGenerationState {
    /// Total number of chunks to generate.
    pub total_chunks: u32,
    /// Number of chunks that have completed generation.
    pub chunks_completed: u32,
    /// Whether generation is complete.
    pub is_complete: bool,
    /// Whether we're loading from disk (not generating).
    pub loading_from_disk: bool,
    /// Accumulated world stats during generation.
    world_stats: WorldStats,
    /// Time when generation started.
    start_time: Option<std::time::Instant>,
}

impl Default for ChunkGenerationState {
    fn default() -> Self {
        Self {
            total_chunks: 0,
            chunks_completed: 0,
            is_complete: true, // Default to complete (no generation needed)
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: None,
        }
    }
}

impl ChunkGenerationState {
    /// Returns the generation progress as a percentage (0.0 to 1.0).
    pub fn progress(&self) -> f32 {
        if self.total_chunks == 0 {
            return 1.0;
        }
        self.chunks_completed as f32 / self.total_chunks as f32
    }

    /// Returns true if generation is in progress.
    pub fn is_generating(&self) -> bool {
        !self.is_complete && !self.loading_from_disk
    }
}

fn should_poll_chunk_generation_tasks(gen_state: &ChunkGenerationState) -> bool {
    !gen_state.is_complete && !gen_state.loading_from_disk && gen_state.total_chunks > 0
}

/// Component to hold a pending chunk generation task.
#[derive(Component)]
struct ChunkGenerationTask {
    task: Task<ChunkGenerationResult>,
    chunk_pos: IVec3,
}

/// Component to hold an asynchronous saved-world load task.
#[derive(Component)]
struct WorldLoadTask {
    task: Task<Result<VoxelWorld, String>>,
}

#[derive(Resource, Default, Debug)]
struct WorldStartupOverlayState {
    ready_seconds: f32,
}

#[derive(Resource, Default, Debug)]
pub(crate) struct WorldStartupLoadingFlames {
    pub active: bool,
}

#[derive(Resource, Default, Debug)]
struct WorldStartupSetupState {
    frames_waited: u8,
    started: bool,
}

#[derive(Resource, Default, Debug)]
struct PendingWorldGeneration {
    requested: bool,
}

#[derive(Resource, Default)]
struct WorldGenerationQueue {
    positions: Vec<IVec3>,
    next_index: usize,
    generator: Option<Arc<TerrainGenerator>>,
}

impl WorldGenerationQueue {
    fn begin(&mut self, positions: Vec<IVec3>, generator: Arc<TerrainGenerator>) {
        self.positions = positions;
        self.next_index = 0;
        self.generator = Some(generator);
    }

    fn remaining(&self) -> usize {
        self.positions.len().saturating_sub(self.next_index)
    }

    fn take_next_batch(
        &mut self,
        max_batch_size: usize,
    ) -> Option<(Vec<IVec3>, Arc<TerrainGenerator>, bool)> {
        if self.remaining() == 0 {
            self.positions.clear();
            self.next_index = 0;
            self.generator = None;
            return None;
        }

        let generator = Arc::clone(self.generator.as_ref()?);
        let batch_size = max_batch_size.max(1);
        let end_index = (self.next_index + batch_size).min(self.positions.len());
        let batch = self.positions[self.next_index..end_index].to_vec();
        self.next_index = end_index;
        let complete = self.remaining() == 0;

        if complete {
            self.positions.clear();
            self.next_index = 0;
            self.generator = None;
        }

        Some((batch, generator, complete))
    }
}

#[derive(Component)]
struct WorldStartupOverlay;

#[derive(Component)]
struct WorldStartupBackgroundImage;

#[derive(Component)]
struct WorldStartupFlamesMaterial;

#[derive(Component)]
struct WorldStartupTitleText;

#[derive(Component)]
struct WorldStartupDetailText;

#[derive(Component)]
struct WorldStartupPercentText;

#[derive(Component)]
struct WorldStartupProgressFill;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorldStartupStage {
    LoadingSavedWorld,
    GeneratingTerrain,
    PreparingMeshes,
    Ready,
}

struct WorldStartupSnapshot {
    stage: WorldStartupStage,
    progress: f32,
    detail: String,
    complete: bool,
}

impl WorldStartupStage {
    fn title(self) -> &'static str {
        match self {
            Self::LoadingSavedWorld => "Loading existing world",
            Self::GeneratingTerrain => "Generating world",
            Self::PreparingMeshes => "Preparing terrain",
            Self::Ready => "World ready",
        }
    }
}

impl Plugin for VoxelPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins((
            ExtractComponentPlugin::<ChunkMesh>::default(),
            ExtractComponentPlugin::<WaterMesh>::default(),
            ExtractComponentPlugin::<WaterMeshDetail>::default(),
            TerrainHoleProbePlugin,
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
        .insert_resource(McTransvoxelSettings::load_or_default())
        .insert_resource(McTransvoxelRuntimeStats::default())
        .insert_resource(TerrainLodControl::default())
        .insert_resource(TerrainLodTransitionState::default())
        .insert_resource(SkirtConfig::default())
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
        .insert_resource(ChunkOctree::default())
        .insert_resource(VisibleChunks::default())
        .insert_resource(EnclosureState::default())
        .insert_resource(EnclosureOcclusionStats::default())
        // Enclosure detection enables this at runtime only when the player is indoors or underground.
        .insert_resource(OcclusionConfig {
            enabled: false,
            ..default()
        })
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
                sync_occlusion_config_from_enclosure.after(update_enclosure_state),
                toggle_enclosure_culling,
                // Stage 2: Face visibility + GPU detection (independent resources, can be parallel)
                update_chunk_face_visibility_system.after(sync_occlusion_config_from_enclosure),
                adjust_lod_for_integrated_gpu.after(poll_chunk_generation_tasks),
                // Stage 3: Octree + BFS (both Res<VoxelWorld>, can be parallel)
                update_octree_system.after(update_chunk_face_visibility_system),
                update_visible_chunks_system.after(update_chunk_face_visibility_system),
                apply_visibility_culling_system
                    .after(update_octree_system)
                    .after(update_visible_chunks_system),
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

// =============================================================================
// World Setup
// =============================================================================

/// Debug flag to generate a flat world for testing. Disabled by default.
const DEBUG_FLAT_WORLD: bool = false;

fn should_attempt_saved_world_load(persistence_settings: &WorldPersistence) -> bool {
    if env_flag("VOXEL_REGENERATE_WATER_BODIES")
        || env_flag("VOXEL_FORCE_REGENERATE_WORLD")
        || env_flag("VOXEL_FORCE_REGENERATE_WATER")
    {
        match persistence::delete_saved_world_at_path(&persistence_settings.path) {
            Ok(()) => info!(
                "Water body regeneration requested; deleted saved world so terrain can regenerate"
            ),
            Err(e) => warn!("Failed to delete saved world for water regeneration: {}", e),
        }
        return false;
    }

    if persistence_settings.force_regenerate {
        return false;
    }

    if !persistence::saved_world_exists_at_path(&persistence_settings.path) {
        return false;
    }

    true
}

fn load_saved_world_for_runtime(
    persistence_settings: &WorldPersistence,
) -> Result<VoxelWorld, String> {
    if env_flag("DRUSNIEL_EDITOR_NATIVE_VIEWPORT")
        || persistence_settings.allow_terrain_fingerprint_mismatch
    {
        info!("Loading saved world data without terrain fingerprint validation...");
        return persistence::read_world_data_from_path(&persistence_settings.path)
            .map(VoxelWorld::from_data)
            .map_err(|err| err.to_string());
    }

    info!(
        "Loading saved world from {}...",
        persistence_settings.path.display()
    );
    persistence::load_world_from_path(&persistence_settings.path).map_err(|err| err.to_string())
}

fn expected_world_chunk_count(size_chunks: IVec3) -> usize {
    if size_chunks.x <= 0 || size_chunks.y <= 0 || size_chunks.z <= 0 {
        return 0;
    }

    size_chunks.x as usize * size_chunks.y as usize * size_chunks.z as usize
}

fn enforce_bedrock_floor(world: &mut VoxelWorld) -> bool {
    let mut changed = false;

    let chunk_positions: Vec<IVec3> = world.chunk_positions().collect();
    for chunk_pos in chunk_positions {
        let chunk_min_y = chunk_pos.y * CHUNK_SIZE_I32;
        let chunk_max_y = chunk_min_y + CHUNK_SIZE_I32 - 1;

        if BEDROCK_DEPTH < chunk_min_y {
            continue;
        }

        let max_local_y = if BEDROCK_DEPTH >= chunk_max_y {
            CHUNK_SIZE_I32 - 1
        } else {
            BEDROCK_DEPTH - chunk_min_y
        };

        if max_local_y < 0 {
            continue;
        }

        let mut chunk_changed = false;
        let Some(mut chunk) = world.get_chunk_mut(chunk_pos) else {
            continue;
        };
        for x in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                for y in 0..=max_local_y as u32 {
                    let local = UVec3::new(x as u32, y, z as u32);
                    if chunk.get(local) != VoxelType::Bedrock {
                        chunk.set(local, VoxelType::Bedrock);
                        chunk_changed = true;
                    }
                }
            }
        }

        if chunk_changed {
            chunk.mark_dirty_with_reason(MeshDirtyReason::Generation);
            changed = true;
        }
    }

    changed
}

/// Statistics for a generated chunk.
#[derive(Default)]
struct ChunkStats {
    sand: u32,
    dungeon_wall: u32,
    dungeon_floor: u32,
    wood: u32,
    leaves: u32,
}

/// Aggregate statistics for world generation.
#[derive(Default)]
struct WorldStats {
    total_sand: u32,
    total_dungeon_wall: u32,
    total_dungeon_floor: u32,
    total_wood: u32,
    total_leaves: u32,
    // Uniformity statistics
    empty_chunks: u32,
    solid_chunks: u32,
    mixed_chunks: u32,
}

impl WorldStats {
    fn add(&mut self, chunk_stats: &ChunkStats, uniformity: ChunkUniformity) {
        self.total_sand += chunk_stats.sand;
        self.total_dungeon_wall += chunk_stats.dungeon_wall;
        self.total_dungeon_floor += chunk_stats.dungeon_floor;
        self.total_wood += chunk_stats.wood;
        self.total_leaves += chunk_stats.leaves;

        match uniformity {
            ChunkUniformity::Empty => self.empty_chunks += 1,
            ChunkUniformity::Solid => self.solid_chunks += 1,
            ChunkUniformity::Mixed => self.mixed_chunks += 1,
            ChunkUniformity::Unknown => {} // Shouldn't happen after compute_uniformity
        }
    }

    fn log_summary(&self, generation_time: std::time::Duration) {
        let total_chunks = self.empty_chunks + self.solid_chunks + self.mixed_chunks;
        let skippable = self.empty_chunks + self.solid_chunks;
        let skip_percent = if total_chunks > 0 {
            (skippable as f32 / total_chunks as f32) * 100.0
        } else {
            0.0
        };

        info!("=== WORLD GENERATION SUMMARY ===");
        info!("Generation time: {:.2}s", generation_time.as_secs_f32());
        info!("--- Chunk Uniformity (mesh optimization) ---");
        info!(
            "  Empty chunks (all air): {} ({:.1}% of total)",
            self.empty_chunks,
            (self.empty_chunks as f32 / total_chunks as f32) * 100.0
        );
        info!(
            "  Solid chunks (no internal surfaces): {} ({:.1}% of total)",
            self.solid_chunks,
            (self.solid_chunks as f32 / total_chunks as f32) * 100.0
        );
        info!(
            "  Mixed chunks (need full meshing): {} ({:.1}% of total)",
            self.mixed_chunks,
            (self.mixed_chunks as f32 / total_chunks as f32) * 100.0
        );
        info!(
            "  Skippable chunks: {}/{} ({:.1}%)",
            skippable, total_chunks, skip_percent
        );
        info!("--- Block Statistics ---");
        info!("  Sand blocks: {}", self.total_sand);
        info!("  Dungeon wall blocks: {}", self.total_dungeon_wall);
        info!("  Dungeon floor blocks: {}", self.total_dungeon_floor);
        info!("  Wood blocks: {}", self.total_wood);
        info!("  Leaves blocks: {}", self.total_leaves);
    }
}

/// Saves the world if auto_save is enabled.
fn try_save_world(world: &VoxelWorld, persistence_settings: &WorldPersistence) {
    if !persistence_settings.auto_save {
        return;
    }

    info!("Saving world to disk...");
    match persistence::save_world_to_path(world, &persistence_settings.path) {
        Ok(()) => info!("World saved successfully!"),
        Err(e) => warn!("Failed to save world: {}", e),
    }
}

/// Main world setup system - spawns async chunk generation tasks.
fn start_voxel_world_after_overlay_frame(
    mut commands: Commands,
    world: Res<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    persistence_settings: Res<WorldPersistence>,
    mut setup_state: ResMut<WorldStartupSetupState>,
    mut generation_queue: ResMut<WorldGenerationQueue>,
) {
    if setup_state.started {
        return;
    }

    if setup_state.frames_waited < WORLD_STARTUP_SETUP_DELAY_FRAMES {
        setup_state.frames_waited += 1;
        return;
    }

    setup_state.started = true;

    if should_attempt_saved_world_load(&persistence_settings) {
        gen_state.total_chunks = 0;
        gen_state.chunks_completed = 0;
        gen_state.is_complete = false;
        gen_state.loading_from_disk = true;
        gen_state.world_stats = WorldStats::default();
        gen_state.start_time = Some(std::time::Instant::now());

        let persistence_settings = persistence_settings.clone();
        let task = AsyncComputeTaskPool::get()
            .spawn(async move { load_saved_world_for_runtime(&persistence_settings) });
        commands.spawn(WorldLoadTask { task });
        return;
    }

    begin_world_generation(&world, &mut gen_state, &mut generation_queue);
}

fn begin_world_generation(
    world: &VoxelWorld,
    gen_state: &mut ChunkGenerationState,
    generation_queue: &mut WorldGenerationQueue,
) {
    info!("Generating new world (async)...");

    let chunk_positions: Vec<IVec3> = world.all_chunk_positions().collect();
    let total_chunks = chunk_positions.len() as u32;

    gen_state.total_chunks = total_chunks;
    gen_state.chunks_completed = 0;
    gen_state.is_complete = false;
    gen_state.loading_from_disk = false;
    gen_state.world_stats = WorldStats::default();
    gen_state.start_time = Some(std::time::Instant::now());

    let generator = Arc::new(TerrainGenerator::default());
    generation_queue.begin(chunk_positions, generator);
    info!(
        "Queued {} async chunk generation tasks for batched startup spawning",
        total_chunks
    );
}

/// Polls the asynchronous saved-world load before starting generation fallback.
fn poll_world_load_task(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut pending_generation: ResMut<PendingWorldGeneration>,
    mut tasks: Query<(Entity, &mut WorldLoadTask)>,
    persistence_settings: Res<WorldPersistence>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    lod_settings: Res<LodSettings>,
    bench_forensics: Option<Res<BenchForensicsConfig>>,
) {
    for (entity, mut task) in tasks.iter_mut() {
        let Some(result) = block_on(poll_once(&mut task.task)) else {
            continue;
        };

        commands.entity(entity).despawn();

        match result {
            Ok(loaded_world) => {
                if loaded_world.world_size_chunks() != world.world_size_chunks() {
                    warn!(
                        "Saved world size {:?} does not match configured world size {:?}; regenerating",
                        loaded_world.world_size_chunks(),
                        world.world_size_chunks()
                    );
                    request_world_generation(&mut gen_state, &mut pending_generation);
                    continue;
                }

                let loaded_chunks = loaded_world.chunk_entries().count();
                let expected_chunks = expected_world_chunk_count(loaded_world.world_size_chunks());
                if loaded_chunks != expected_chunks {
                    warn!(
                        "Saved world contains {}/{} chunks; regenerating incomplete save",
                        loaded_chunks, expected_chunks
                    );
                    request_world_generation(&mut gen_state, &mut pending_generation);
                    continue;
                }

                *world = loaded_world;
                let camera_pos = camera_query
                    .single()
                    .ok()
                    .map(|transform| transform.translation);
                assign_initial_lods_for_loaded_world(
                    &mut world,
                    camera_pos,
                    &lod_settings,
                    bench_forensics.as_deref(),
                );
                gen_state.total_chunks = loaded_chunks as u32;
                gen_state.chunks_completed = gen_state.total_chunks;
                gen_state.is_complete = true;
                gen_state.loading_from_disk = true;
                gen_state.start_time = None;
                gen_state.world_stats = WorldStats::default();

                if enforce_bedrock_floor(&mut world) {
                    info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
                    try_save_world(&world, &persistence_settings);
                }

                info!("World loaded successfully!");
            }
            Err(err) => {
                warn!(
                    "Failed to load saved world: {}. Generating new world...",
                    err
                );
                request_world_generation(&mut gen_state, &mut pending_generation);
            }
        }
    }
}

fn request_world_generation(
    gen_state: &mut ChunkGenerationState,
    pending_generation: &mut PendingWorldGeneration,
) {
    gen_state.total_chunks = 0;
    gen_state.chunks_completed = 0;
    gen_state.is_complete = false;
    gen_state.loading_from_disk = false;
    gen_state.world_stats = WorldStats::default();
    gen_state.start_time = Some(std::time::Instant::now());
    pending_generation.requested = true;
}

fn start_pending_world_generation(
    world: Res<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut pending_generation: ResMut<PendingWorldGeneration>,
    mut generation_queue: ResMut<WorldGenerationQueue>,
) {
    if !pending_generation.requested {
        return;
    }

    pending_generation.requested = false;
    begin_world_generation(&world, &mut gen_state, &mut generation_queue);
}

fn spawn_queued_chunk_generation_tasks(
    mut commands: Commands,
    mut generation_queue: ResMut<WorldGenerationQueue>,
) {
    let Some((chunk_positions, generator, complete)) =
        generation_queue.take_next_batch(WORLD_GENERATION_TASK_SPAWN_BATCH)
    else {
        return;
    };

    let spawned_count = chunk_positions.len();
    let task_pool = AsyncComputeTaskPool::get();
    for chunk_pos in chunk_positions {
        let generator = Arc::clone(&generator);
        let task = task_pool.spawn(async move {
            let (chunk, stats) = generate_chunk_async(chunk_pos, &generator);
            ChunkGenerationResult { chunk, stats }
        });

        commands.spawn(ChunkGenerationTask { task, chunk_pos });
    }

    if complete {
        info!("Finished spawning queued chunk generation tasks");
    } else {
        debug!(
            "Spawned {} queued chunk generation tasks this frame; {} remaining",
            spawned_count,
            generation_queue.remaining()
        );
    }
}

/// Tag bumped with each MC+Transvoxel hole-fix series. Logged at startup so
/// the user can verify their binary contains the latest source changes
/// without guessing from visuals. Bump when landing a fix that should affect
/// the visible mesh.
const MC_SPIKE_BUILD_TAG: &str = "mc-spike-2026-05-24-sdf-sign-guard-and-lod-refine-coarser";

fn log_mc_spike_build_tag(mc_settings: Res<McTransvoxelSettings>) {
    #[cfg(feature = "mc_transvoxel")]
    let mode = format!("{:?}", mc_settings.mode);
    #[cfg(not(feature = "mc_transvoxel"))]
    let mode = "feature-disabled".to_string();

    info!(
        "MC+Transvoxel spike build tag: {}; enabled={} mode={} lod_delta_policy={:?}",
        MC_SPIKE_BUILD_TAG, mc_settings.enabled, mode, mc_settings.lod_delta_policy,
    );
}

fn spawn_world_startup_overlay(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut flame_materials: ResMut<Assets<LoadingFlamesMaterial>>,
    mut loading_flames: ResMut<WorldStartupLoadingFlames>,
) {
    let background_image = asset_server.load("images/DrunsielShyntara.png");
    let flame_material = flame_materials.add(LoadingFlamesMaterial {
        uniform: LoadingFlamesUniform::default(),
    });
    loading_flames.active = true;

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left: Val::Px(0.0),
                right: Val::Px(0.0),
                top: Val::Px(0.0),
                bottom: Val::Px(0.0),
                flex_direction: FlexDirection::Column,
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                row_gap: Val::Px(12.0),
                padding: UiRect::all(Val::Px(24.0)),
                overflow: Overflow::clip(),
                ..default()
            },
            BackgroundColor(Color::srgb(0.015, 0.018, 0.02)),
            WorldStartupOverlay,
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: Val::Px(0.0),
                    right: Val::Px(0.0),
                    top: Val::Px(0.0),
                    bottom: Val::Px(0.0),
                    ..default()
                },
                ImageNode::new(background_image).with_mode(NodeImageMode::Stretch),
                WorldStartupBackgroundImage,
                ));

              root.spawn((
                  MaterialNode(flame_material),
                  Node {
                      position_type: PositionType::Absolute,
                      left: Val::Px(0.0),
                      right: Val::Px(0.0),
                      top: Val::Px(0.0),
                      bottom: Val::Px(0.0),
                      ..default()
                  },
                  WorldStartupFlamesMaterial,
              ));

              root.spawn((
                  Node {
                      position_type: PositionType::Absolute,
                    left: Val::Px(0.0),
                    right: Val::Px(0.0),
                    top: Val::Px(0.0),
                    bottom: Val::Px(0.0),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.02, 0.025, 0.03, 0.58)),
            ));

            root.spawn(Node {
                flex_direction: FlexDirection::Column,
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                row_gap: Val::Px(12.0),
                ..default()
            })
            .with_children(|content| {
                content.spawn((
                    Text::new("Loading existing world"),
                    TextFont {
                        font_size: 28.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.95, 0.97, 0.96, 1.0)),
                    WorldStartupTitleText,
                ));

                content.spawn((
                    Text::new("Checking saved world"),
                    TextFont {
                        font_size: 16.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.82, 0.88, 0.86, 1.0)),
                    WorldStartupDetailText,
                ));

                content
                    .spawn((
                        Node {
                            width: Val::Px(420.0),
                            max_width: Val::Percent(82.0),
                            height: Val::Px(10.0),
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.08, 0.1, 0.09, 0.9)),
                    ))
                    .with_children(|bar| {
                        bar.spawn((
                            Node {
                                width: Val::Percent(8.0),
                                height: Val::Percent(100.0),
                                ..default()
                            },
                            BackgroundColor(Color::srgba(0.47, 0.76, 0.46, 1.0)),
                            WorldStartupProgressFill,
                        ));
                    });

                content.spawn((
                    Text::new("Loading..."),
                    TextFont {
                        font_size: 14.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.9, 0.94, 0.92, 1.0)),
                    WorldStartupPercentText,
                ));
            });
        });
}

fn update_world_startup_background_cover(
    windows: Query<&Window, With<PrimaryWindow>>,
    images: Res<Assets<Image>>,
    mut background_query: Query<(&mut Node, &ImageNode), With<WorldStartupBackgroundImage>>,
) {
    let Ok(window) = windows.single() else {
        return;
    };
    let window_size = Vec2::new(window.width(), window.height());

    for (mut node, image_node) in background_query.iter_mut() {
        let Some(image) = images.get(&image_node.image) else {
            continue;
        };
        let Some(draw_size) = world_startup_background_cover_size(
            window_size,
            image.size().as_vec2(),
            WORLD_STARTUP_BACKGROUND_ZOOM,
        ) else {
            continue;
        };

        node.width = Val::Px(draw_size.x);
        node.height = Val::Px(draw_size.y);
        node.left = Val::Px((window_size.x - draw_size.x) * 0.5);
        node.top = Val::Px((window_size.y - draw_size.y) * 0.5);
        node.right = Val::Auto;
        node.bottom = Val::Auto;
    }
}

fn world_startup_background_cover_size(
    window_size: Vec2,
    image_size: Vec2,
    zoom: f32,
) -> Option<Vec2> {
    if window_size.x <= 0.0 || window_size.y <= 0.0 || image_size.x <= 0.0 || image_size.y <= 0.0 {
        return None;
    }

    let cover_scale = (window_size.x / image_size.x).max(window_size.y / image_size.y);
    Some(image_size * cover_scale * zoom.max(1.0))
}

fn update_world_startup_overlay(
    mut commands: Commands,
    time: Res<Time>,
    gen_state: Res<ChunkGenerationState>,
    chunk_stats: Res<RuntimeChunkStats>,
    setup_state: Res<WorldStartupSetupState>,
    mut overlay_state: ResMut<WorldStartupOverlayState>,
    mut loading_flames: ResMut<WorldStartupLoadingFlames>,
    windows: Query<&Window, With<PrimaryWindow>>,
    root_query: Query<Entity, With<WorldStartupOverlay>>,
    flame_query: Query<&MaterialNode<LoadingFlamesMaterial>, With<WorldStartupFlamesMaterial>>,
    mut flame_materials: ResMut<Assets<LoadingFlamesMaterial>>,
    mut text_queries: ParamSet<(
        Query<&mut Text, With<WorldStartupTitleText>>,
        Query<&mut Text, With<WorldStartupDetailText>>,
        Query<&mut Text, With<WorldStartupPercentText>>,
    )>,
    mut fill_query: Query<&mut Node, With<WorldStartupProgressFill>>,
) {
    let Ok(root_entity) = root_query.single() else {
        loading_flames.active = false;
        return;
    };
    loading_flames.active = true;

    let (resolution, mouse) = windows
        .single()
        .ok()
        .map(|window| {
            (
                Vec2::new(window.width().max(1.0), window.height().max(1.0)),
                window.cursor_position().unwrap_or(Vec2::ZERO),
            )
        })
        .unwrap_or((Vec2::new(1280.0, 720.0), Vec2::ZERO));
    for material_node in flame_query.iter() {
        if let Some(material) = flame_materials.get_mut(&material_node.0) {
            material.uniform.time = time.elapsed_secs();
            material.uniform.resolution = resolution;
            material.uniform.mouse = mouse;
        }
    }

    let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, setup_state.started);
    if snapshot.complete {
        loading_flames.active = false;
        overlay_state.ready_seconds += time.delta_secs();
    } else {
        loading_flames.active = true;
        overlay_state.ready_seconds = 0.0;
    }

    if overlay_state.ready_seconds >= WORLD_STARTUP_READY_HOLD_SECONDS {
        loading_flames.active = false;
        commands.entity(root_entity).despawn();
        return;
    }

    if let Ok(mut text) = text_queries.p0().single_mut() {
        text.0 = snapshot.stage.title().to_string();
    }
    if let Ok(mut text) = text_queries.p1().single_mut() {
        text.0 = snapshot.detail;
    }
    if let Ok(mut text) = text_queries.p2().single_mut() {
        text.0 = if snapshot.stage == WorldStartupStage::LoadingSavedWorld {
            "Loading...".to_string()
        } else {
            format!("{:.0}%", snapshot.progress * 100.0)
        };
    }
    if let Ok(mut node) = fill_query.single_mut() {
        node.width = Val::Percent((snapshot.progress * 100.0).clamp(0.0, 100.0));
    }
}

fn world_startup_snapshot(
    gen_state: &ChunkGenerationState,
    chunk_stats: &RuntimeChunkStats,
    setup_started: bool,
) -> WorldStartupSnapshot {
    if !setup_started {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::LoadingSavedWorld,
            progress: 0.05,
            detail: "Starting world load".to_string(),
            complete: false,
        };
    }

    if !gen_state.is_complete && gen_state.loading_from_disk {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::LoadingSavedWorld,
            progress: 0.12,
            detail: "Reading saved terrain data".to_string(),
            complete: false,
        };
    }

    if gen_state.is_generating() {
        let progress = gen_state.progress().clamp(0.0, 1.0);
        return WorldStartupSnapshot {
            stage: WorldStartupStage::GeneratingTerrain,
            progress: progress * 0.9,
            detail: format!(
                "Generated {} of {} chunks",
                gen_state.chunks_completed, gen_state.total_chunks
            ),
            complete: false,
        };
    }

    if chunk_stats.mesh_entities == 0 && chunk_stats.chunks_meshed_this_frame == 0 {
        let detail = if gen_state.loading_from_disk {
            "Saved world loaded; building visible terrain meshes"
        } else {
            "Terrain chunks complete; building visible meshes"
        };
        return WorldStartupSnapshot {
            stage: WorldStartupStage::PreparingMeshes,
            progress: 0.95,
            detail: detail.to_string(),
            complete: false,
        };
    }

    if chunk_stats.dirty_chunks_queued > 0
        || chunk_stats.surface_nets_chunks_deferred_for_halo > 0
        || chunk_stats.chunks_meshed_this_frame > 0
        || chunk_stats.chunks_skipped_this_frame > 0
    {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::PreparingMeshes,
            progress: 0.98,
            detail: format!(
                "Building terrain meshes ({} queued, {} waiting for neighbors)",
                chunk_stats.dirty_chunks_queued, chunk_stats.surface_nets_chunks_deferred_for_halo
            ),
            complete: false,
        };
    }

    WorldStartupSnapshot {
        stage: WorldStartupStage::Ready,
        progress: 1.0,
        detail: format!(
            "Prepared {} terrain mesh chunks",
            chunk_stats
                .mesh_entities
                .max(chunk_stats.chunks_meshed_this_frame)
        ),
        complete: true,
    }
}

/// Generates a single chunk using the terrain generator (for async execution).
#[derive(Clone, Copy)]
struct TerrainColumn {
    terrain_height: i32,
    biome: Biome,
    water: WaterGenerationMetadata,
    tree: Option<GeneratedTree>,
}

#[derive(Clone, Copy)]
struct GeneratedTree {
    world_x: i32,
    world_z: i32,
    trunk_top: i32,
    leaf_center_y: i32,
}

fn generate_chunk_async(chunk_pos: IVec3, generator: &TerrainGenerator) -> (Chunk, ChunkStats) {
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
    let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;

    let mut voxels = [VoxelType::Air; CHUNK_VOLUME];

    if DEBUG_FLAT_WORLD {
        for z in 0..CHUNK_SIZE {
            for y in 0..CHUNK_SIZE {
                let world_y = chunk_world_y + y as i32;
                let voxel = if world_y <= 12 {
                    VoxelType::TopSoil
                } else {
                    VoxelType::Air
                };
                for x in 0..CHUNK_SIZE {
                    voxels[Chunk::index(x, y, z)] = voxel;
                }
            }
        }
    } else {
        let columns = precompute_terrain_columns(chunk_world_x, chunk_world_z, generator);
        fill_chunk_voxels(
            &mut voxels,
            &columns,
            chunk_world_x,
            chunk_world_y,
            chunk_world_z,
            generator,
        );
        let trees = precompute_overlapping_trees(chunk_world_x, chunk_world_z, &columns, generator);
        paint_tree_leaves(
            &mut voxels,
            &columns,
            &trees,
            chunk_world_x,
            chunk_world_y,
            chunk_world_z,
        );
    }

    let stats = collect_chunk_stats(&voxels);
    let chunk = Chunk::with_voxels(chunk_pos, voxels);
    (chunk, stats)
}

fn precompute_terrain_columns(
    chunk_world_x: i32,
    chunk_world_z: i32,
    generator: &TerrainGenerator,
) -> [TerrainColumn; CHUNK_SIZE * CHUNK_SIZE] {
    std::array::from_fn(|index| {
        let x = index % CHUNK_SIZE;
        let z = index / CHUNK_SIZE;
        let world_x = chunk_world_x + x as i32;
        let world_z = chunk_world_z + z as i32;
        let (terrain_height, water) =
            generator.get_height_and_water_generation_metadata(world_x, world_z);
        let biome = generator.get_biome(world_x, world_z);
        let tree = tree_at(generator, world_x, world_z, terrain_height);
        TerrainColumn {
            terrain_height,
            biome,
            water,
            tree,
        }
    })
}

fn precompute_overlapping_trees(
    chunk_world_x: i32,
    chunk_world_z: i32,
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    generator: &TerrainGenerator,
) -> Vec<GeneratedTree> {
    let min_x = chunk_world_x - TREE_LEAF_CHECK_RADIUS;
    let max_x = chunk_world_x + CHUNK_SIZE_I32 - 1 + TREE_LEAF_CHECK_RADIUS;
    let min_z = chunk_world_z - TREE_LEAF_CHECK_RADIUS;
    let max_z = chunk_world_z + CHUNK_SIZE_I32 - 1 + TREE_LEAF_CHECK_RADIUS;
    let mut trees = Vec::new();

    for world_z in min_z..=max_z {
        for world_x in min_x..=max_x {
            let terrain_height = tree_scan_terrain_height(
                chunk_world_x,
                chunk_world_z,
                columns,
                generator,
                world_x,
                world_z,
            );
            if let Some(tree) = tree_at(generator, world_x, world_z, terrain_height) {
                trees.push(tree);
            }
        }
    }

    trees
}

fn tree_scan_terrain_height(
    chunk_world_x: i32,
    chunk_world_z: i32,
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    generator: &TerrainGenerator,
    world_x: i32,
    world_z: i32,
) -> i32 {
    let local_x = world_x - chunk_world_x;
    let local_z = world_z - chunk_world_z;
    if (0..CHUNK_SIZE_I32).contains(&local_x) && (0..CHUNK_SIZE_I32).contains(&local_z) {
        columns[column_index(local_x as usize, local_z as usize)].terrain_height
    } else {
        generator
            .get_height_and_water_generation_metadata(world_x, world_z)
            .0
    }
}

fn tree_at(
    generator: &TerrainGenerator,
    world_x: i32,
    world_z: i32,
    terrain_height: i32,
) -> Option<GeneratedTree> {
    if !generator.should_spawn_tree(world_x, world_z, terrain_height) {
        return None;
    }

    let trunk_height = generator.get_tree_height(world_x, world_z);
    let trunk_top = terrain_height + 1 + trunk_height;
    Some(GeneratedTree {
        world_x,
        world_z,
        trunk_top,
        leaf_center_y: trunk_top - 1,
    })
}

fn fill_chunk_voxels(
    voxels: &mut [VoxelType; CHUNK_VOLUME],
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    chunk_world_x: i32,
    chunk_world_y: i32,
    chunk_world_z: i32,
    generator: &TerrainGenerator,
) {
    for x in 0..CHUNK_SIZE {
        for z in 0..CHUNK_SIZE {
            let world_x = chunk_world_x + x as i32;
            let world_z = chunk_world_z + z as i32;
            let column = columns[column_index(x, z)];

            for y in 0..CHUNK_SIZE {
                let world_y = chunk_world_y + y as i32;
                voxels[Chunk::index(x, y, z)] =
                    voxel_from_column(generator, column, world_x, world_y, world_z);
            }
        }
    }
}

fn voxel_from_column(
    generator: &TerrainGenerator,
    column: TerrainColumn,
    world_x: i32,
    world_y: i32,
    world_z: i32,
) -> VoxelType {
    if world_y <= BEDROCK_DEPTH {
        return VoxelType::Bedrock;
    }

    if generator.is_cave(world_x, world_y, world_z, column.terrain_height) {
        return if generator.is_cave_aquifer(world_x, world_y, world_z) {
            VoxelType::Water
        } else {
            VoxelType::Air
        };
    }

    if column
        .tree
        .is_some_and(|tree| world_y >= column.terrain_height + 1 && world_y < tree.trunk_top)
    {
        return VoxelType::Wood;
    }

    if world_y > column.terrain_height {
        return if column.water.is_surface_water() && world_y <= column.water.surface_y {
            VoxelType::Water
        } else {
            VoxelType::Air
        };
    }

    let depth = column.terrain_height - world_y;
    let near_water = column.terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET;
    generator.get_biome_voxel(column.biome, depth, near_water)
}

fn paint_tree_leaves(
    voxels: &mut [VoxelType; CHUNK_VOLUME],
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    trees: &[GeneratedTree],
    chunk_world_x: i32,
    chunk_world_y: i32,
    chunk_world_z: i32,
) {
    let chunk_max_x = chunk_world_x + CHUNK_SIZE_I32 - 1;
    let chunk_max_y = chunk_world_y + CHUNK_SIZE_I32 - 1;
    let chunk_max_z = chunk_world_z + CHUNK_SIZE_I32 - 1;
    let leaf_radius_sq = TREE_LEAF_RADIUS * TREE_LEAF_RADIUS;

    for tree in trees {
        let min_x = (tree.world_x - TREE_LEAF_CHECK_RADIUS).max(chunk_world_x);
        let max_x = (tree.world_x + TREE_LEAF_CHECK_RADIUS).min(chunk_max_x);
        let min_z = (tree.world_z - TREE_LEAF_CHECK_RADIUS).max(chunk_world_z);
        let max_z = (tree.world_z + TREE_LEAF_CHECK_RADIUS).min(chunk_max_z);

        for world_z in min_z..=max_z {
            for world_x in min_x..=max_x {
                let local_x = (world_x - chunk_world_x) as usize;
                let local_z = (world_z - chunk_world_z) as usize;
                let column = columns[column_index(local_x, local_z)];
                let dx = tree.world_x - world_x;
                let dz = tree.world_z - world_z;
                let xz_dist_sq = (dx * dx + dz * dz) as f32;
                if xz_dist_sq >= leaf_radius_sq {
                    continue;
                }

                for world_y in chunk_world_y..=chunk_max_y {
                    if world_y <= column.terrain_height {
                        continue;
                    }

                    let dy = world_y - tree.leaf_center_y;
                    let dist_sq = xz_dist_sq + (dy * dy) as f32 * 1.5;
                    if dist_sq >= leaf_radius_sq {
                        continue;
                    }
                    if dx == 0 && dz == 0 && world_y < tree.trunk_top {
                        continue;
                    }

                    let local_y = (world_y - chunk_world_y) as usize;
                    let index = Chunk::index(local_x, local_y, local_z);
                    if voxels[index] != VoxelType::Wood {
                        voxels[index] = VoxelType::Leaves;
                    }
                }
            }
        }
    }
}

#[inline]
fn column_index(x: usize, z: usize) -> usize {
    x + z * CHUNK_SIZE
}

fn collect_chunk_stats(voxels: &[VoxelType; CHUNK_VOLUME]) -> ChunkStats {
    let mut stats = ChunkStats::default();
    for &voxel in voxels {
        match voxel {
            VoxelType::Sand => stats.sand += 1,
            VoxelType::DungeonWall => stats.dungeon_wall += 1,
            VoxelType::DungeonFloor => stats.dungeon_floor += 1,
            VoxelType::Wood => stats.wood += 1,
            VoxelType::Leaves => stats.leaves += 1,
            _ => {}
        }
    }
    stats
}

/// Polls completed chunk generation tasks and inserts chunks into the world.
fn poll_chunk_generation_tasks(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut tasks: Query<(Entity, &mut ChunkGenerationTask)>,
    persistence_settings: Res<WorldPersistence>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    lod_settings: Res<LodSettings>,
    bench_forensics: Option<Res<BenchForensicsConfig>>,
) {
    // Skip until actual generation work has been queued.
    if !should_poll_chunk_generation_tasks(&gen_state) {
        return;
    }

    // Poll all pending tasks
    let mut completed_count = 0u32;
    let camera_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation);

    for (entity, mut task) in tasks.iter_mut() {
        if let Some(result) = block_on(poll_once(&mut task.task)) {
            let ChunkGenerationResult { mut chunk, stats } = result;
            // Task completed - insert chunk into world
            let chunk_pos = task.chunk_pos;
            let uniformity = chunk.uniformity();

            // Log chunks with dungeon content
            if stats.dungeon_wall > 0 || stats.dungeon_floor > 0 {
                let chunk_world = IVec3::new(
                    chunk_pos.x * CHUNK_SIZE_I32,
                    chunk_pos.y * CHUNK_SIZE_I32,
                    chunk_pos.z * CHUNK_SIZE_I32,
                );
                debug!(
                    "Chunk {:?} (world {:?}): {} dungeon walls, {} floors",
                    chunk_pos, chunk_world, stats.dungeon_wall, stats.dungeon_floor
                );
            }

            // Update stats
            gen_state.world_stats.add(&stats, uniformity);

            // Insert chunk into world
            let initial_lod = initial_lod_for_chunk(
                &chunk,
                camera_pos,
                &lod_settings,
                bench_forensics.as_deref(),
            );
            chunk.set_initial_lod_level(initial_lod);
            world.insert_chunk(chunk);
            mark_surface_nets_halo_dirty(&mut world, chunk_pos);

            // Despawn the task entity
            commands.entity(entity).despawn();

            completed_count += 1;
        }
    }

    gen_state.chunks_completed += completed_count;

    // Log progress periodically (every 10%)
    if completed_count > 0 {
        let progress_pct = (gen_state.progress() * 100.0) as u32;
        let prev_progress_pct = ((gen_state.chunks_completed - completed_count) as f32
            / gen_state.total_chunks as f32
            * 100.0) as u32;

        // Log at 10% intervals
        if progress_pct / 10 > prev_progress_pct / 10 {
            info!(
                "World generation: {}% ({}/{} chunks)",
                progress_pct, gen_state.chunks_completed, gen_state.total_chunks
            );
        }
    }

    // Check if generation is complete
    if gen_state.chunks_completed >= gen_state.total_chunks {
        gen_state.is_complete = true;

        if let Some(start_time) = gen_state.start_time {
            gen_state.world_stats.log_summary(start_time.elapsed());
        }

        // Apply bedrock floor
        if enforce_bedrock_floor(&mut world) {
            info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
        }

        // Save world
        try_save_world(&world, &persistence_settings);
    }
}

fn mark_surface_nets_halo_dirty(world: &mut VoxelWorld, chunk_pos: IVec3) {
    mark_chunk_halo_dirty(world, chunk_pos, MeshDirtyReason::Generation);
}

fn mark_chunk_lod_halo_dirty(world: &mut VoxelWorld, chunk_pos: IVec3) {
    for offset in [
        IVec3::new(1, 0, 0),
        IVec3::new(-1, 0, 0),
        IVec3::new(0, 1, 0),
        IVec3::new(0, -1, 0),
        IVec3::new(0, 0, 1),
        IVec3::new(0, 0, -1),
    ] {
        world.mark_chunk_dirty_with_reason(chunk_pos + offset, MeshDirtyReason::NeighborLod);
    }
}

fn mark_chunk_halo_dirty(world: &mut VoxelWorld, chunk_pos: IVec3, reason: MeshDirtyReason) {
    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 && dz == 0 {
                    continue;
                }

                let neighbor_pos = chunk_pos + IVec3::new(dx, dy, dz);
                world.mark_chunk_dirty_with_reason(neighbor_pos, reason);
            }
        }
    }
}

fn initial_lod_for_chunk(
    chunk: &Chunk,
    camera_pos: Option<Vec3>,
    lod_settings: &LodSettings,
    forensics: Option<&BenchForensicsConfig>,
) -> LodLevel {
    if let Some(lod) = forensics_forced_lod(forensics) {
        return lod;
    }
    let Some(camera_pos) = camera_pos else {
        return chunk.lod_level();
    };

    let distance = terrain_lod_distance_xz(chunk.position(), camera_pos);
    let target_lod = calculate_target_lod_with_hysteresis(distance, LodLevel::Lod0, lod_settings);
    water_shore_guarded_lod(
        target_lod,
        distance,
        lod_settings,
        chunk_contains_liquid(chunk) || chunk_layer_intersects_waterline(chunk.position()),
    )
}

fn assign_initial_lods_for_loaded_world(
    world: &mut VoxelWorld,
    camera_pos: Option<Vec3>,
    lod_settings: &LodSettings,
    forensics: Option<&BenchForensicsConfig>,
) {
    if let Some(lod) = forensics_forced_lod(forensics) {
        let positions: Vec<IVec3> = world.chunk_positions().collect();
        for chunk_pos in positions {
            if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                chunk.set_initial_lod_level(lod);
            }
        }
        return;
    }
    let Some(camera_pos) = camera_pos else {
        return;
    };

    let water_lod_guard_chunks = collect_water_shore_lod_guard_chunks(world);
    let positions: Vec<IVec3> = world.chunk_positions().collect();
    for chunk_pos in positions {
        let distance = terrain_lod_distance_xz(chunk_pos, camera_pos);
        let target_lod =
            calculate_target_lod_with_hysteresis(distance, LodLevel::Lod0, lod_settings);
        let target_lod = water_shore_guarded_lod(
            target_lod,
            distance,
            lod_settings,
            water_lod_guard_chunks.contains(&chunk_pos),
        );
        if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
            chunk.set_initial_lod_level(target_lod);
        }
    }
}

fn should_defer_surface_nets_mesh(target_mode: MeshMode, missing_boundary_neighbors: u32) -> bool {
    matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && missing_boundary_neighbors > 0
}

fn visual_surface_nets_lod(lod_level: LodLevel) -> LodLevel {
    match lod_level {
        LodLevel::Lod3 => LodLevel::Lod2,
        other => other,
    }
}

fn resolve_terrain_mesh_mode(
    base_mode: MeshMode,
    chunk_pos: IVec3,
    logical_lod: LodLevel,
    mc_settings: &McTransvoxelSettings,
    camera_pos: Option<Vec3>,
) -> MeshMode {
    if base_mode != MeshMode::SurfaceNets || !mc_settings.enabled {
        return base_mode;
    }
    let camera_chunk = camera_pos.map(|pos| {
        VoxelWorld::world_to_chunk(IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        ))
    });
    if mc_settings.should_mesh_chunk(chunk_pos, camera_chunk, logical_lod) {
        MeshMode::McTransvoxel
    } else {
        base_mode
    }
}

fn forensics_forced_lod(forensics: Option<&BenchForensicsConfig>) -> Option<LodLevel> {
    let forensics = forensics.filter(|config| config.enabled)?;
    match forensics.terrain_lod {
        BenchForensicsTerrainLod::Auto => None,
        BenchForensicsTerrainLod::AllLod0 => Some(LodLevel::Lod0),
        BenchForensicsTerrainLod::AllLod1 => Some(LodLevel::Lod1),
    }
}

fn forensics_mesh_mode_override(
    base_mode: MeshMode,
    forensics: Option<&BenchForensicsConfig>,
) -> MeshMode {
    let Some(forensics) = forensics.filter(|config| config.enabled) else {
        return base_mode;
    };
    match forensics.terrain_mesher {
        BenchForensicsTerrainMesher::Auto => base_mode,
        BenchForensicsTerrainMesher::SurfaceNets => MeshMode::SurfaceNets,
        BenchForensicsTerrainMesher::McTransvoxel => MeshMode::McTransvoxel,
    }
}

fn mesh_forensics_options(
    forensics: Option<&BenchForensicsConfig>,
    mc_settings: &McTransvoxelSettings,
) -> MeshForensicsOptions {
    let Some(forensics) = forensics.filter(|config| config.enabled) else {
        return MeshForensicsOptions {
            enabled: mc_settings.debug_triangle_sources,
            mc_transitions: McTransitionForensicsMode::Enabled,
        };
    };
    MeshForensicsOptions {
        enabled: true,
        mc_transitions: match forensics.mc_transitions {
            BenchForensicsMcTransitions::Enabled => McTransitionForensicsMode::Enabled,
            BenchForensicsMcTransitions::DisabledKeepBoundaryRows => {
                McTransitionForensicsMode::DisabledKeepBoundaryRows
            }
        },
    }
}

fn lod_level_from_index(index: u8) -> LodLevel {
    match index {
        0 => LodLevel::Lod0,
        1 => LodLevel::Lod1,
        2 => LodLevel::Lod2,
        _ => LodLevel::Lod3,
    }
}

/// Enforce that no two face-adjacent chunks have LOD indices differing by
/// more than 1 by refining the coarser side of violating boundaries. Returns
/// the set of chunks whose `desired` LOD was modified by this pass; pass-3
/// uses it to bypass the LOD-change cooldown for these coherence-mandated
/// changes (otherwise forced refinements sit blocked for 30 frames during
/// camera motion, leaving transient LOD deltas of 2+ that MC+Transvoxel
/// cannot bridge).
fn enforce_lod_delta_max_one(desired: &mut HashMap<IVec3, LodLevel>) -> HashSet<IVec3> {
    const FACE_OFFSETS: [IVec3; 6] = [
        IVec3::new(1, 0, 0),
        IVec3::new(-1, 0, 0),
        IVec3::new(0, 1, 0),
        IVec3::new(0, -1, 0),
        IVec3::new(0, 0, 1),
        IVec3::new(0, 0, -1),
    ];
    let mut forced: HashSet<IVec3> = HashSet::new();
    for _ in 0..6 {
        let mut updates: HashMap<IVec3, LodLevel> = HashMap::new();
        for (chunk_pos, &lod) in desired.iter() {
            let Some(my_idx) = lod.lod_index() else {
                continue;
            };
            for offset in FACE_OFFSETS {
                let Some(&neighbor_lod) = desired.get(&(*chunk_pos + offset)) else {
                    continue;
                };
                let Some(neighbor_idx) = neighbor_lod.lod_index() else {
                    continue;
                };
                if my_idx <= neighbor_idx + 1 {
                    continue;
                }
                let target = lod_level_from_index(neighbor_idx + 1);
                updates
                    .entry(*chunk_pos)
                    .and_modify(|existing| {
                        if target.is_higher_detail_than(*existing) {
                            *existing = target;
                        }
                    })
                    .or_insert(target);
            }
        }
        if updates.is_empty() {
            break;
        }
        for (pos, lod) in updates {
            desired.insert(pos, lod);
            forced.insert(pos);
        }
    }
    forced
}

pub(crate) fn target_terrain_mesh_mode_for_lod(
    lod_level: LodLevel,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> MeshMode {
    match lod_level {
        LodLevel::Lod0 => mesh_settings.mode,
        LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 | LodLevel::Culled => {
            lod_settings.low_detail_mode
        }
    }
}

fn mesh_lod_level_for_surface_nets_cap(
    target_mode: MeshMode,
    uniformity: ChunkUniformity,
    empty_surface_neighbor: bool,
    lod_level: LodLevel,
) -> LodLevel {
    let mesh_lod_level = if matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && uniformity == ChunkUniformity::Empty
        && empty_surface_neighbor
    {
        LodLevel::Lod0
    } else {
        lod_level
    };

    if matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel) {
        visual_surface_nets_lod(mesh_lod_level)
    } else {
        mesh_lod_level
    }
}

pub(crate) fn effective_terrain_mesh_lod_for_chunk(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> Option<LodLevel> {
    let chunk = world.get_chunk(chunk_pos)?;
    let lod_level = chunk.lod_level();

    if lod_level == LodLevel::Culled {
        return Some(LodLevel::Culled);
    }

    let target_mode = target_terrain_mesh_mode_for_lod(lod_level, mesh_settings, lod_settings);
    let empty_surface_neighbor = chunk.uniformity() == ChunkUniformity::Empty
        && matches!(target_mode, MeshMode::SurfaceNets)
        && empty_chunk_has_surface_nets_boundary_surface(world, chunk_pos);

    Some(mesh_lod_level_for_surface_nets_cap(
        target_mode,
        chunk.uniformity(),
        empty_surface_neighbor,
        lod_level,
    ))
}

pub(crate) fn build_terrain_neighbor_lods(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> NeighborLods {
    NeighborLods {
        neg_x: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(-1, 0, 0),
            mesh_settings,
            lod_settings,
        ),
        pos_x: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(1, 0, 0),
            mesh_settings,
            lod_settings,
        ),
        neg_y: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, -1, 0),
            mesh_settings,
            lod_settings,
        ),
        pos_y: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 1, 0),
            mesh_settings,
            lod_settings,
        ),
        neg_z: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 0, -1),
            mesh_settings,
            lod_settings,
        ),
        pos_z: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 0, 1),
            mesh_settings,
            lod_settings,
        ),
    }
}

#[derive(Default)]
struct MeshDirtyReasonCounts {
    lod: u32,
    neighbor_lod: u32,
    generation: u32,
    water_material: u32,
    terrain_mutation: u32,
}

impl MeshDirtyReasonCounts {
    fn add_flags(&mut self, flags: u8) {
        if flags & MeshDirtyReason::Lod.bit() != 0 {
            self.lod += 1;
        }
        if flags & MeshDirtyReason::NeighborLod.bit() != 0 {
            self.neighbor_lod += 1;
        }
        if flags & MeshDirtyReason::Generation.bit() != 0 {
            self.generation += 1;
        }
        if flags & MeshDirtyReason::WaterMaterial.bit() != 0 {
            self.water_material += 1;
        }
        if flags & MeshDirtyReason::TerrainMutation.bit() != 0 {
            self.terrain_mutation += 1;
        }
    }
}

fn chunks_per_frame_limit_for_dirty_meshes(
    reason_counts: &MeshDirtyReasonCounts,
    lod_churn_only: bool,
    generation_complete: bool,
) -> usize {
    if lod_churn_only {
        return MAX_LOD_DIRTY_CHUNKS_PER_FRAME;
    }

    if generation_complete && reason_counts.generation > 0 && reason_counts.terrain_mutation == 0 {
        return MAX_STARTUP_CHUNKS_PER_FRAME;
    }

    MAX_CHUNKS_PER_FRAME
}

#[derive(SystemParam)]
struct MeshDirtyTimingParams<'w> {
    frame: Res<'w, FrameCount>,
    timing: ResMut<'w, AreaTimingRecorder>,
    gen_state: Res<'w, ChunkGenerationState>,
}

#[derive(SystemParam)]
struct McSpikeMeshParams<'w> {
    settings: Res<'w, McTransvoxelSettings>,
    stats: ResMut<'w, McTransvoxelRuntimeStats>,
}

#[derive(SystemParam)]
struct BenchMeshForensicsParams<'w> {
    toggles: Option<Res<'w, BenchRenderToggles>>,
    forensics: Option<Res<'w, BenchForensicsConfig>>,
}

fn mesh_dirty_chunks_system(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut meshes: ResMut<Assets<Mesh>>,
    blocky_material: Option<Res<VoxelMaterial>>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    water_material: Res<WaterMaterial>,
    bench_params: BenchMeshForensicsParams,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    mut mc_spike: McSpikeMeshParams,
    skirt_config: Res<SkirtConfig>,
    ao_config: Res<AmbientOcclusionConfig>,
    mut chunk_stats: ResMut<RuntimeChunkStats>,
    mut material_logged: Local<bool>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut timing_params: MeshDirtyTimingParams,
) {
    let frame = &timing_params.frame;
    let timing = &mut timing_params.timing;
    let generation_complete = timing_params.gen_state.is_complete;
    let mesh_dirty_total_start = timing.enabled.then(Instant::now);
    // Reset per-frame counters
    chunk_stats.reset_frame_counters();
    mc_spike.stats.chunks_meshed_this_frame = 0;

    // Wait for blocky material to be loaded before processing chunks.
    let blocky_material = if let Some(mat) = blocky_material {
        if !*material_logged {
            debug!("Blocky material loaded, mesh processing enabled");
            *material_logged = true;
        }
        Some(mat)
    } else {
        None
    };

    if matches!(mesh_settings.mode, MeshMode::Blocky) && blocky_material.is_none() {
        // Material not yet loaded - this is expected during startup
        return;
    }

    // Collect dirty chunks and sort by distance from camera (nearest first)
    // This prioritizes meshing chunks close to the player for better visual quality
    let mut dirty_chunks: Vec<IVec3> = world.dirty_chunks().collect();
    let dirty_chunks_queued = dirty_chunks.len();
    let had_dirty_chunks = !dirty_chunks.is_empty();
    let mut reason_counts = MeshDirtyReasonCounts::default();
    for chunk_pos in &dirty_chunks {
        if let Some(chunk) = world.get_chunk(*chunk_pos) {
            reason_counts.add_flags(chunk.dirty_reason_flags());
        }
    }
    let camera_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation);
    let sort_start = timing.enabled.then(Instant::now);
    let mesh_dirty_sort_window = prioritize_dirty_chunks_for_camera(
        &mut dirty_chunks,
        camera_pos,
        MAX_DIRTY_CHUNKS_VISITED_PER_FRAME,
    );
    let mesh_dirty_sort_us = sort_start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0);
    let mut chunks_meshed = 0u32;
    let mut chunks_skipped = 0u32;
    let mut chunks_processed = 0usize;
    let mut mesh_dirty_generate_us = 0u64;
    let mut mesh_dirty_apply_us = 0u64;
    let lod_churn_only = reason_counts.generation == 0
        && reason_counts.terrain_mutation == 0
        && (reason_counts.lod > 0
            || reason_counts.neighbor_lod > 0
            || reason_counts.water_material > 0);
    let chunks_per_frame_limit = chunks_per_frame_limit_for_dirty_meshes(
        &reason_counts,
        lod_churn_only,
        generation_complete,
    );
    let mut terrain_mesh_empty_but_solid_voxels = 0u32;
    let mut terrain_mesh_boundary_missing_neighbor = 0u32;
    let mut surface_nets_chunks_deferred_for_halo = 0u32;
    let terrain_mesh_degenerate_triangles_removed = 0u32;
    let mut terrain_mesh_lod_seam_repairs = 0u32;

    for chunk_pos in dirty_chunks {
        // Throttle expensive mesh generation, but let cheap empty/culled clears
        // drain faster so dirty queues do not stay backed up for hundreds of frames.
        let dirty_visit_limit = if !lod_churn_only
            && surface_nets_chunks_deferred_for_halo > 0
            && chunks_meshed as usize <= chunks_per_frame_limit
        {
            MAX_DIRTY_CHUNKS_VISITED_WITH_DEFERRED_PER_FRAME
        } else {
            MAX_DIRTY_CHUNKS_VISITED_PER_FRAME
        };
        if chunks_processed >= dirty_visit_limit || chunks_meshed as usize >= chunks_per_frame_limit
        {
            break;
        }
        chunks_processed += 1;
        // Compute uniformity if unknown (lazy evaluation)
        if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
            if chunk.uniformity() == ChunkUniformity::Unknown {
                chunk.compute_uniformity();
            }
        }

        let (target_mode, lod_level, uniformity) = if let Some(chunk) = world.get_chunk(chunk_pos) {
            let base_mode =
                target_terrain_mesh_mode_for_lod(chunk.lod_level(), &mesh_settings, &lod_settings);
            let target_mode = resolve_terrain_mesh_mode(
                base_mode,
                chunk_pos,
                chunk.lod_level(),
                &mc_spike.settings,
                camera_pos,
            );
            let target_mode =
                forensics_mesh_mode_override(target_mode, bench_params.forensics.as_deref());

            (target_mode, chunk.lod_level(), chunk.uniformity())
        } else {
            continue;
        };

        // Skip meshing for culled chunks
        if lod_level == LodLevel::Culled {
            if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                if let Some(entity) = chunk.mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_mesh_entity();
                }
                if let Some(entity) = chunk.water_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mesh_entity();
                }
                if let Some(entity) = chunk.water_mask_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mask_mesh_entity();
                }
                chunk.clear_dirty();
            }
            chunks_skipped += 1;
            continue;
        }

        let empty_surface_neighbor = uniformity == ChunkUniformity::Empty
            && matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
            && empty_chunk_has_surface_nets_boundary_surface(&world, chunk_pos);
        let mesh_lod_level = mesh_lod_level_for_surface_nets_cap(
            target_mode,
            uniformity,
            empty_surface_neighbor,
            lod_level,
        );

        // Skip meshing for empty chunks unless Surface Nets needs this all-air
        // chunk to own a terrain boundary surface from the one-voxel halo.
        if uniformity == ChunkUniformity::Empty {
            if empty_surface_neighbor {
                terrain_mesh_lod_seam_repairs += 1;
            } else {
                if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                    if let Some(entity) = chunk.mesh_entity() {
                        commands.entity(entity).despawn();
                        chunk.clear_mesh_entity();
                    }
                    if let Some(entity) = chunk.water_mesh_entity() {
                        commands.entity(entity).despawn();
                        chunk.clear_water_mesh_entity();
                    }
                    if let Some(entity) = chunk.water_mask_mesh_entity() {
                        commands.entity(entity).despawn();
                        chunk.clear_water_mask_mesh_entity();
                    }
                    chunk.clear_dirty();
                }
                chunks_skipped += 1;
                continue;
            }
        }

        let missing_boundary_neighbors =
            count_missing_in_bounds_boundary_neighbors(&world, chunk_pos);
        if missing_boundary_neighbors > 0 {
            terrain_mesh_boundary_missing_neighbor += 1;
            if should_defer_surface_nets_mesh(target_mode, missing_boundary_neighbors) {
                surface_nets_chunks_deferred_for_halo += 1;
                chunks_skipped += 1;
                continue;
            }
        }

        if matches!(target_mode, MeshMode::Blocky) && blocky_material.is_none() {
            chunks_skipped += 1;
            continue;
        }

        let neighbor_lods =
            build_terrain_neighbor_lods(&world, chunk_pos, &mesh_settings, &lod_settings);

        // Step 1: Generate mesh data using immutable borrow (with timing)
        let mesh_start = Instant::now();
        let mesh_result = if let Some(chunk) = world.get_chunk(chunk_pos) {
            generate_chunk_mesh_with_mode_and_forensics(
                chunk,
                &world,
                target_mode,
                mesh_lod_level,
                neighbor_lods,
                &skirt_config,
                &ao_config.baked,
                mesh_settings.water_air_exposure_mode,
                mesh_forensics_options(bench_params.forensics.as_deref(), &mc_spike.settings),
            )
        } else {
            continue;
        };
        let mesh_elapsed = mesh_start.elapsed();
        mesh_dirty_generate_us += mesh_elapsed.as_micros() as u64;

        // Track mesh pressure before buffers are consumed.
        let vertex_count = mesh_result.solid.positions.len() as u32;
        let triangle_count = (mesh_result.solid.indices.len() / 3) as u32;
        if uniformity == ChunkUniformity::Mixed && triangle_count == 0 {
            terrain_mesh_empty_but_solid_voxels += 1;
        }
        chunk_stats.water_air_boundaries_total +=
            mesh_result.water_stats.air_boundaries_total as u64;
        chunk_stats.water_air_boundaries_exposed +=
            mesh_result.water_stats.air_boundaries_exposed as u64;
        chunk_stats.water_air_boundaries_sealed +=
            mesh_result.water_stats.air_boundaries_sealed as u64;
        chunk_stats.water_triangles_removed_sealed +=
            mesh_result.water_stats.triangles_removed_sealed as u64;
        chunk_stats.invalid_water_meshes_suppressed +=
            mesh_result.water_stats.invalid_meshes_suppressed as u64;
        chunk_stats.edge_water_faces_suppressed +=
            mesh_result.water_stats.edge_water_faces_suppressed as u64;
        chunk_stats.water_flood_fill_boundary_hits +=
            mesh_result.water_stats.flood_fill_boundary_hits as u64;
        chunk_stats.water_exposure_outside_world_rejected +=
            mesh_result.water_stats.exposure_outside_world_rejected as u64;

        if let Some(mc_stats) = mesh_result.mc_transvoxel_stats {
            mc_spike.stats.chunks_meshed_this_frame += 1;
            mc_spike.stats.aggregated.regular_chunks_meshed = mc_spike
                .stats
                .aggregated
                .regular_chunks_meshed
                .saturating_add(mc_stats.regular_chunks_meshed);
            for (dst, src) in mc_spike
                .stats
                .aggregated
                .transition_faces_meshed
                .iter_mut()
                .zip(mc_stats.transition_faces_meshed)
            {
                *dst = dst.saturating_add(src);
            }
            mc_spike.stats.aggregated.transition_triangles_total = mc_spike
                .stats
                .aggregated
                .transition_triangles_total
                .saturating_add(mc_stats.transition_triangles_total);
            mc_spike.stats.aggregated.skipped_lod_delta_gt_one = mc_spike
                .stats
                .aggregated
                .skipped_lod_delta_gt_one
                .saturating_add(mc_stats.skipped_lod_delta_gt_one);
            mc_spike.stats.aggregated.skipped_missing_neighbor = mc_spike
                .stats
                .aggregated
                .skipped_missing_neighbor
                .saturating_add(mc_stats.skipped_missing_neighbor);
            mc_spike.stats.aggregated.mesh_generation_ms_total += mc_stats.mesh_generation_ms_total;
            mc_spike.stats.aggregated.triangle_count_regular = mc_spike
                .stats
                .aggregated
                .triangle_count_regular
                .saturating_add(mc_stats.triangle_count_regular);
            mc_spike.stats.aggregated.triangle_count_transition = mc_spike
                .stats
                .aggregated
                .triangle_count_transition
                .saturating_add(mc_stats.triangle_count_transition);
        }

        let water_depth_detail = if mesh_result.water.is_empty() {
            WaterChunkDepthDetail::default()
        } else {
            compute_water_chunk_depth_detail(&world, chunk_pos)
        };

        // Step 2: Update chunk state using mutable borrow
        let apply_start = timing.enabled.then(Instant::now);
        if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
            // Clear dirty flag
            chunk.clear_dirty();

            let world_pos = VoxelWorld::chunk_to_world(chunk_pos);
            let terrain_quality =
                terrain_material_quality_for_lod(lod_level, bench_params.toggles.as_deref());
            let triplanar_handle = triplanar_material.handle_for_quality(terrain_quality);
            let chunk_mesh = crate::voxel::meshing::ChunkMesh {
                chunk_position: chunk_pos,
                vertex_count,
                triangle_count,
                mesh_mode: target_mode,
                material_quality: terrain_quality,
            };
            let terrain_mesh_debug = TerrainMeshDebug {
                logical_lod_at_mesh: lod_level,
                effective_lod_at_mesh: mesh_lod_level,
                target_mode_at_mesh: target_mode,
                neighbor_lods_at_mesh: neighbor_lods,
                lod_delta_gt_one_face_mask: lod_delta_gt_one_face_mask(lod_level, &neighbor_lods),
                missing_boundary_neighbors_at_mesh: missing_boundary_neighbors,
                empty_surface_cap_at_mesh: empty_surface_neighbor,
                generated_frame: frame.0,
                lod_transition_snap_stats: mesh_result.lod_transition_snap_stats,
                mesh_section_stats: mesh_result.mesh_section_stats,
                mc_transvoxel_stats: mesh_result.mc_transvoxel_stats,
            };
            let mc_triangle_sources = mesh_result.mc_triangle_sources.clone();

            // Track meshing statistics
            chunk_stats.meshing_time_us += mesh_elapsed.as_micros() as u64;
            chunk_stats.add_mesh_vertices(vertex_count, lod_level);

            // Handle solid mesh
            if mesh_result.solid.is_empty() {
                if let Some(entity) = chunk.mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_mesh_entity();
                }
            } else {
                let mesh = mesh_result.solid.into_mesh();
                let mesh_handle = meshes.add(mesh);

                if let Some(entity) = chunk.mesh_entity() {
                    // Update existing entity with new mesh AND correct material for current mode
                    match target_mode {
                        MeshMode::Blocky => {
                            if let Some(blocky_mat) = blocky_material.as_ref() {
                                commands
                                    .entity(entity)
                                    .insert((
                                        Mesh3d(mesh_handle),
                                        MeshMaterial3d(blocky_mat.handle.clone()),
                                        chunk_mesh,
                                        terrain_mesh_debug,
                                        NeedsCollider,
                                    ))
                                    .remove::<MeshMaterial3d<
                                        crate::rendering::triplanar_material::TriplanarMaterial,
                                    >>();
                            }
                        }
                        MeshMode::SurfaceNets | MeshMode::McTransvoxel => {
                            commands
                                .entity(entity)
                                .insert((
                                    Mesh3d(mesh_handle),
                                    MeshMaterial3d(triplanar_handle),
                                    chunk_mesh,
                                    terrain_mesh_debug,
                                    NeedsCollider,
                                ))
                                .remove::<MeshMaterial3d<crate::rendering::blocky_material::BlockyMaterial>>();
                        }
                    }
                    let mut entity_cmd = commands.entity(entity);
                    if let Some(sources) = mc_triangle_sources.clone() {
                        entity_cmd.insert(sources);
                    } else {
                        entity_cmd.remove::<McTriangleSources>();
                    }
                } else {
                    // Chunks whose top Y exceeds the water line are visible from above
                    // (or straddle the surface) and must appear in the reflection pass.
                    // Fully underwater chunks stay in layer 0 only.
                    let chunk_top_y = (chunk_pos.y + 1) * CHUNK_SIZE_I32;
                    let terrain_layers = if chunk_top_y > WATER_LEVEL {
                        RenderLayers::default().with(REFLECTION_RENDER_LAYER)
                    } else {
                        RenderLayers::default()
                    };

                    // Spawn with appropriate material based on mesh mode
                    let entity = match target_mode {
                        MeshMode::Blocky => {
                            let Some(blocky_material) = blocky_material.as_ref() else {
                                continue;
                            };
                            commands
                                .spawn((
                                    Mesh3d(mesh_handle),
                                    MeshMaterial3d(blocky_material.handle.clone()),
                                    Transform::from_xyz(
                                        world_pos.x as f32,
                                        world_pos.y as f32,
                                        world_pos.z as f32,
                                    ),
                                    chunk_mesh,
                                    terrain_mesh_debug,
                                    NeedsCollider,
                                    terrain_layers,
                                ))
                                .id()
                        }
                        MeshMode::SurfaceNets | MeshMode::McTransvoxel => commands
                            .spawn((
                                Mesh3d(mesh_handle),
                                MeshMaterial3d(triplanar_handle),
                                Transform::from_xyz(
                                    world_pos.x as f32,
                                    world_pos.y as f32,
                                    world_pos.z as f32,
                                ),
                                chunk_mesh,
                                terrain_mesh_debug,
                                NeedsCollider,
                                terrain_layers,
                            ))
                            .id(),
                    };
                    let mut entity_cmd = commands.entity(entity);
                    if let Some(sources) = mc_triangle_sources {
                        entity_cmd.insert(sources);
                    } else {
                        entity_cmd.remove::<McTriangleSources>();
                    }
                    chunk.set_mesh_entity(entity);
                }
            }

            // Handle water mesh
            if mesh_result.water.is_empty() {
                if let Some(entity) = chunk.water_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mesh_entity();
                }
                if let Some(entity) = chunk.water_mask_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mask_mesh_entity();
                }
            } else {
                let water_vertex_count = mesh_result.water.positions.len() as u32;
                let water_triangle_count = mesh_result.water.indices.len() / 3;
                let water_mesh = mesh_result.water.into_mesh();
                let water_mesh_handle = meshes.add(water_mesh);
                let force_fancy = env_flag("VOXEL_FORCE_ALL_WATER_FANCY");
                let force_cheap = env_flag("VOXEL_FORCE_ALL_WATER_CHEAP");
                let use_fancy_water = force_fancy && !force_cheap;

                if let Some(entity) = chunk.water_mesh_entity() {
                    let mut entity_cmd = commands.entity(entity);
                    entity_cmd.insert((
                        Mesh3d(water_mesh_handle.clone()),
                        crate::voxel::meshing::ChunkMesh {
                            chunk_position: chunk_pos,
                            vertex_count: water_vertex_count,
                            triangle_count: water_triangle_count as u32,
                            mesh_mode: MeshMode::Blocky,
                            material_quality: TerrainMaterialQuality::FullTriplanar,
                        },
                        WaterMesh,
                        WaterMeshDetail {
                            triangle_count: water_triangle_count,
                            max_depth: water_depth_detail.max_depth,
                            average_depth: water_depth_detail.average_depth,
                            surface_area: water_depth_detail.surface_area,
                        },
                        RenderLayers::default(),
                        NotShadowCaster, // Water is translucent — never cast opaque shadows
                    ));
                    if use_fancy_water {
                        entity_cmd
                            .insert(MeshMaterial3d(
                                water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                            ))
                            .remove::<MeshMaterial3d<StandardMaterial>>();
                    } else {
                        entity_cmd
                            .insert(MeshMaterial3d(
                                water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                            ))
                            .remove::<MeshMaterial3d<StandardWaterMaterial>>();
                    }
                } else {
                    let mut entity_cmd = commands.spawn((
                        Mesh3d(water_mesh_handle.clone()),
                        Transform::from_xyz(
                            world_pos.x as f32,
                            world_pos.y as f32,
                            world_pos.z as f32,
                        ),
                        crate::voxel::meshing::ChunkMesh {
                            chunk_position: chunk_pos,
                            vertex_count: water_vertex_count,
                            triangle_count: water_triangle_count as u32,
                            mesh_mode: MeshMode::Blocky,
                            material_quality: TerrainMaterialQuality::FullTriplanar,
                        },
                        WaterMesh,
                        WaterMeshDetail {
                            triangle_count: water_triangle_count,
                            max_depth: water_depth_detail.max_depth,
                            average_depth: water_depth_detail.average_depth,
                            surface_area: water_depth_detail.surface_area,
                        },
                        RenderLayers::default(),
                        NotShadowCaster, // Water is translucent — never cast opaque shadows
                    ));
                    if use_fancy_water {
                        entity_cmd.insert(MeshMaterial3d(
                            water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                        ));
                    } else {
                        entity_cmd.insert(MeshMaterial3d(
                            water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                        ));
                    }
                    let entity = entity_cmd.id();
                    chunk.set_water_mesh_entity(entity);
                }

                let mask_transform =
                    Transform::from_xyz(world_pos.x as f32, world_pos.y as f32, world_pos.z as f32);
                if let Some(mask_entity) = chunk.water_mask_mesh_entity() {
                    commands.entity(mask_entity).insert((
                        Mesh3d(water_mesh_handle.clone()),
                        MeshMaterial3d(water_material.mask_handle.clone()),
                        mask_transform,
                        WaterMaskProxy,
                        RenderLayers::layer(WATER_MASK_RENDER_LAYER),
                        NotShadowCaster,
                    ));
                } else {
                    let mask_entity = commands
                        .spawn((
                            Mesh3d(water_mesh_handle.clone()),
                            MeshMaterial3d(water_material.mask_handle.clone()),
                            mask_transform,
                            WaterMaskProxy,
                            RenderLayers::layer(WATER_MASK_RENDER_LAYER),
                            NotShadowCaster,
                        ))
                        .id();
                    chunk.set_water_mask_mesh_entity(mask_entity);
                }
            }

            chunks_meshed += 1;
        }
        mesh_dirty_apply_us += apply_start
            .map(|start| start.elapsed().as_micros() as u64)
            .unwrap_or(0);
    }

    // Update runtime statistics
    chunk_stats.chunks_meshed_this_frame = chunks_meshed;
    chunk_stats.chunks_skipped_this_frame = chunks_skipped;
    chunk_stats.dirty_chunks_queued = dirty_chunks_queued as u32;
    chunk_stats.surface_nets_chunks_deferred_for_halo = surface_nets_chunks_deferred_for_halo;
    log_transition_stats_if_due(&mc_spike.settings, &mc_spike.stats, frame.0);

    // Keep the O(N) debug/stat snapshot off hot dirty-mesh frames while the
    // terrain queue is backed up. Per-frame mesh counters above stay current.
    let stats_recompute_due = should_recompute_runtime_chunk_stats(frame.0);
    let stats_recompute_blocked = stats_recompute_due
        && should_defer_runtime_chunk_stats_recompute(
            had_dirty_chunks,
            dirty_chunks_queued,
            chunks_per_frame_limit,
        );
    let stats_recompute_start = timing.enabled.then(Instant::now);
    if stats_recompute_due && !stats_recompute_blocked {
        chunk_stats.recompute_from_world(&world);
    }
    let mesh_dirty_stats_us = stats_recompute_start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0);

    if let Some(start) = mesh_dirty_total_start {
        timing.record_area(frame.0, "Mesh Dirty", start.elapsed().as_micros() as u64);
    }
    timing.record_area(frame.0, "Mesh Dirty Sort CPU", mesh_dirty_sort_us);
    timing.record_area(frame.0, "Mesh Dirty Generate CPU", mesh_dirty_generate_us);
    timing.record_area(frame.0, "Mesh Dirty Apply CPU", mesh_dirty_apply_us);
    timing.record_area(frame.0, "Mesh Dirty Stats CPU", mesh_dirty_stats_us);
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Queued",
        dirty_chunks_queued as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Processed",
        chunks_processed as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Deferred",
        dirty_chunks_queued.saturating_sub(chunks_processed) as f64,
    );
    timing.record_count(
        frame.0,
        "MAX_CHUNKS_PER_FRAME Hit",
        u8::from(dirty_chunks_queued > chunks_processed) as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Frame Limit",
        chunks_per_frame_limit as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Visit Limit",
        if !lod_churn_only && surface_nets_chunks_deferred_for_halo > 0 {
            MAX_DIRTY_CHUNKS_VISITED_WITH_DEFERRED_PER_FRAME
        } else {
            MAX_DIRTY_CHUNKS_VISITED_PER_FRAME
        } as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Sort Window",
        mesh_dirty_sort_window as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty LOD Churn Only",
        lod_churn_only as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Stats Recompute Blocked",
        stats_recompute_blocked as u8 as f64,
    );
    timing.record_count(frame.0, "Mesh Dirty Reason LOD", reason_counts.lod as f64);
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Neighbor LOD",
        reason_counts.neighbor_lod as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Generation",
        reason_counts.generation as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Water Material",
        reason_counts.water_material as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Terrain Mutation",
        reason_counts.terrain_mutation as f64,
    );
    timing.record_count(
        frame.0,
        "Water Air Boundaries Total",
        chunk_stats.water_air_boundaries_total as f64,
    );
    timing.record_count(
        frame.0,
        "Water Air Boundaries Exposed",
        chunk_stats.water_air_boundaries_exposed as f64,
    );
    timing.record_count(
        frame.0,
        "Water Air Boundaries Sealed",
        chunk_stats.water_air_boundaries_sealed as f64,
    );
    timing.record_count(
        frame.0,
        "Water Triangles Removed Sealed",
        chunk_stats.water_triangles_removed_sealed as f64,
    );
    timing.record_count(
        frame.0,
        "Invalid Water Meshes Suppressed",
        chunk_stats.invalid_water_meshes_suppressed as f64,
    );
    timing.record_count(
        frame.0,
        "Edge Water Faces Suppressed",
        chunk_stats.edge_water_faces_suppressed as f64,
    );
    timing.record_count(
        frame.0,
        "Water Flood Fill Boundary Hits",
        chunk_stats.water_flood_fill_boundary_hits as f64,
    );
    timing.record_count(
        frame.0,
        "Water Exposure Outside World Rejected",
        chunk_stats.water_exposure_outside_world_rejected as f64,
    );
    timing.record_count(
        frame.0,
        "Water Mesh Entities",
        chunk_stats.water_mesh_entities as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Empty But Solid Voxels",
        terrain_mesh_empty_but_solid_voxels as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Boundary Missing Neighbor",
        terrain_mesh_boundary_missing_neighbor as f64,
    );
    timing.record_count(
        frame.0,
        "Surface Nets Chunks Deferred For Halo",
        surface_nets_chunks_deferred_for_halo as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Degenerate Triangles Removed",
        terrain_mesh_degenerate_triangles_removed as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh LOD Seam Repairs",
        terrain_mesh_lod_seam_repairs as f64,
    );
}

fn prioritize_dirty_chunks_for_camera(
    dirty_chunks: &mut [IVec3],
    camera_pos: Option<Vec3>,
    visit_limit: usize,
) -> usize {
    let Some(camera_pos) = camera_pos else {
        return 0;
    };
    if dirty_chunks.is_empty() || visit_limit == 0 {
        return 0;
    }

    let sort_window = dirty_chunks.len().min(visit_limit);
    if sort_window < dirty_chunks.len() {
        dirty_chunks.select_nth_unstable_by(sort_window, |a, b| {
            compare_dirty_chunk_distance(a, b, camera_pos)
        });
        dirty_chunks[..sort_window].sort_by(|a, b| compare_dirty_chunk_distance(a, b, camera_pos));
    } else {
        dirty_chunks.sort_by(|a, b| compare_dirty_chunk_distance(a, b, camera_pos));
    }
    sort_window
}

fn should_recompute_runtime_chunk_stats(frame: u32) -> bool {
    frame % 30 == 0
}

fn should_defer_runtime_chunk_stats_recompute(
    had_dirty_chunks: bool,
    dirty_chunks_queued: usize,
    chunks_per_frame_limit: usize,
) -> bool {
    had_dirty_chunks && dirty_chunks_queued > chunks_per_frame_limit
}

fn compare_dirty_chunk_distance(a: &IVec3, b: &IVec3, camera_pos: Vec3) -> std::cmp::Ordering {
    let world_a = VoxelWorld::chunk_to_world(*a).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
    let world_b = VoxelWorld::chunk_to_world(*b).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
    let dist_a = world_a.distance_squared(camera_pos);
    let dist_b = world_b.distance_squared(camera_pos);
    dist_a
        .partial_cmp(&dist_b)
        .unwrap_or(std::cmp::Ordering::Equal)
}

fn terrain_material_quality_for_lod(
    lod_level: LodLevel,
    bench_toggles: Option<&BenchRenderToggles>,
) -> TerrainMaterialQuality {
    if let Some(forced) =
        bench_toggles.and_then(|toggles| toggles.terrain_material_quality.forced_quality())
    {
        return forced;
    }
    if bench_toggles.is_some_and(|toggles| toggles.disable_terrain_material_lod) {
        return TerrainMaterialQuality::FullTriplanar;
    }
    match lod_level {
        LodLevel::Lod0 => TerrainMaterialQuality::FullTriplanar,
        LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 | LodLevel::Culled => {
            TerrainMaterialQuality::CheapTriplanar
        }
    }
}

fn terrain_material_quality_for_distance(
    distance: f32,
    current: TerrainMaterialQuality,
    bench_toggles: Option<&BenchRenderToggles>,
    quality_preset: RenderQualityPreset,
) -> TerrainMaterialQuality {
    if let Some(forced) =
        bench_toggles.and_then(|toggles| toggles.terrain_material_quality.forced_quality())
    {
        return forced;
    }
    if bench_toggles.is_some_and(|toggles| toggles.disable_terrain_material_lod) {
        return TerrainMaterialQuality::FullTriplanar;
    }

    let lod_distance = quality_preset.terrain_material_lod_distance(TERRAIN_MATERIAL_LOD_DISTANCE);
    let switch_in = (lod_distance - TERRAIN_MATERIAL_LOD_HYSTERESIS).max(0.0);
    let switch_out = lod_distance + TERRAIN_MATERIAL_LOD_HYSTERESIS;
    match current {
        TerrainMaterialQuality::FullTriplanar if distance > switch_out => {
            TerrainMaterialQuality::CheapTriplanar
        }
        TerrainMaterialQuality::CheapTriplanar | TerrainMaterialQuality::SingleProjectionFar
            if distance < switch_in =>
        {
            TerrainMaterialQuality::FullTriplanar
        }
        TerrainMaterialQuality::CheapTriplanar
        | TerrainMaterialQuality::SingleProjectionFar
        | TerrainMaterialQuality::AtlasOnlyDebug
        | TerrainMaterialQuality::WireframeDebug
        | TerrainMaterialQuality::NormalsDebug
        | TerrainMaterialQuality::WireframeNormalsDebug => current,
        _ => current,
    }
}

fn update_terrain_material_lod(
    time: Res<Time>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    terrain_debug_handles: Option<Res<crate::voxel::terrain_debug::TerrainDebugMaterialHandles>>,
    terrain_debug: Res<crate::voxel::terrain_debug::TerrainDebugView>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    quality_preset: Res<RenderQualityPreset>,
    runtime_debug: Option<Res<crate::runtime_commands::RuntimeViewportDebugState>>,
    mut terrain_meshes: Query<
        (
            &Transform,
            &mut ChunkMesh,
            &mut MeshMaterial3d<TriplanarMaterial>,
            Option<&TerrainMeshDebug>,
        ),
        Without<WaterMesh>,
    >,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < TERRAIN_MATERIAL_UPDATE_INTERVAL {
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation;
    let bench_toggles = bench_toggles.as_deref();
    let forced_quality =
        bench_toggles.and_then(|toggles| toggles.terrain_material_quality.forced_quality());
    let editor_wireframe = runtime_debug.is_some_and(|debug| debug.wireframe);
    let debug_mode = crate::voxel::terrain_debug::terrain_debug_material_mode(
        &terrain_debug,
        editor_wireframe,
        forced_quality,
    );

    for (transform, mut chunk_mesh, mut material, mesh_debug) in &mut terrain_meshes {
        // Both Surface Nets and MC+Transvoxel chunks render with TriplanarMaterial
        // and need the debug-overlay material swap (Alt+F7 / Alt+F8). Without MC
        // here the indicator flips "WIRE ON" but the wireframe never appears on
        // MC chunks because their material handle is never updated.
        if !matches!(
            chunk_mesh.mesh_mode,
            MeshMode::SurfaceNets | MeshMode::McTransvoxel
        ) {
            continue;
        }
        if debug_mode != crate::voxel::terrain_debug::TerrainDebugMaterialMode::None {
            let Some(handles) = terrain_debug_handles.as_ref() else {
                continue;
            };
            let lod = mesh_debug
                .map(|debug| debug.logical_lod_at_mesh)
                .unwrap_or(LodLevel::Lod0);
            if let Some(handle) = handles.handle_for(debug_mode, lod) {
                **material = handle;
            }
            continue;
        }
        let chunk_center = transform.translation + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let distance = chunk_center.distance(camera_pos);
        let target_quality = terrain_material_quality_for_distance(
            distance,
            chunk_mesh.material_quality,
            bench_toggles,
            *quality_preset,
        );
        if target_quality == chunk_mesh.material_quality {
            continue;
        }
        **material = triplanar_material.handle_for_quality(target_quality);
        chunk_mesh.material_quality = target_quality;
    }
}

#[derive(Clone, Debug)]
struct WaterMeshBodySample {
    entity: Entity,
    chunk_pos: IVec3,
    surface_y: i32,
    surface_area: f32,
    max_depth: usize,
    average_depth: f32,
    aabb_min: Vec3,
    aabb_max: Vec3,
    touches_world_edge: bool,
    view_visible: bool,
    edge_north: WaterBodyEdgeMask,
    edge_south: WaterBodyEdgeMask,
    edge_west: WaterBodyEdgeMask,
    edge_east: WaterBodyEdgeMask,
}

type WaterBodyEdgeMask = u32;

#[derive(Clone, Debug)]
struct WaterBodyGroup {
    id: WaterBodyId,
    entities: Vec<Entity>,
    kind: WaterBodyKind,
    aabb_min: Vec3,
    aabb_max: Vec3,
    surface_y: i32,
    surface_area: f32,
    max_depth: usize,
    average_depth: f32,
    nearest_distance: f32,
    visible_chunks: u32,
    material_mode: WaterBodyMaterialMode,
}

fn update_water_body_registry(
    time: Res<Time>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    water_meshes: Query<
        (
            Entity,
            &Transform,
            &ChunkMesh,
            Option<&WaterMeshDetail>,
            Option<&ViewVisibility>,
        ),
        With<WaterMesh>,
    >,
    mut commands: Commands,
    mut registry: ResMut<WaterBodyRegistry>,
    water_config: Option<Res<WaterConfig>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < WATER_BODY_UPDATE_INTERVAL && !world.is_changed() {
        record_water_body_counters(frame.0, &mut timing, &registry);
        return;
    }
    *last_update = now;

    let camera_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation);
    let previous_modes: HashMap<WaterBodyId, WaterBodyMaterialMode> = registry
        .bodies
        .iter()
        .map(|(id, body)| (*id, body.material_mode))
        .collect();

    let mut samples = Vec::new();
    for (entity, transform, chunk_mesh, detail, view_visibility) in &water_meshes {
        let Some(sample) = sample_water_mesh_body(
            &world,
            entity,
            transform,
            chunk_mesh.chunk_position,
            detail,
            view_visibility,
        ) else {
            continue;
        };
        samples.push(sample);
    }

    let mut groups = build_water_body_groups(&samples, &world, camera_pos, &previous_modes);
    if let Some(forced_kind) = forced_water_body_kind("VOXEL_FORCE_WATER_BODY_KIND") {
        for group in &mut groups {
            group.kind = forced_kind;
        }
    } else if let Some(forced_kind) = forced_water_body_kind("VOXEL_FORCE_NEAREST_WATER_KIND") {
        if let Some(nearest_group) = groups
            .iter_mut()
            .min_by(|a, b| a.nearest_distance.total_cmp(&b.nearest_distance))
        {
            nearest_group.kind = forced_kind;
        }
    }
    let mut next_bodies = HashMap::new();
    registry.reset_counts();
    registry.material_switches = 0;

    for group in groups {
        let body_info = WaterBodyInfo {
            id: group.id,
            kind: group.kind,
            aabb_min: group.aabb_min,
            aabb_max: group.aabb_max,
            surface_y: group.surface_y as f32,
            surface_area: group.surface_area,
            max_depth: group.max_depth,
            average_depth: group.average_depth,
            nearest_distance: group.nearest_distance,
            visible_chunks: group.visible_chunks,
            chunk_count: group.entities.len() as u32,
            material_mode: group.material_mode,
            reflection_strength: water_body_reflection_strength(
                group.kind,
                group.max_depth,
                water_config.as_deref(),
            ),
            fresnel_power: water_body_fresnel_power(group.kind, water_config.as_deref()),
            distortion_strength: water_body_distortion_strength(
                group.kind,
                water_config.as_deref(),
            ),
        };
        if previous_modes
            .get(&group.id)
            .is_some_and(|previous| *previous != group.material_mode)
        {
            registry.material_switches += 1;
        }
        for entity in group.entities {
            commands.entity(entity).insert(group.id);
        }
        registry.count_body(&body_info);
        next_bodies.insert(group.id, body_info);
    }

    registry.bodies = next_bodies;
    record_water_body_counters(frame.0, &mut timing, &registry);
}

fn sample_water_mesh_body(
    world: &VoxelWorld,
    entity: Entity,
    transform: &Transform,
    chunk_pos: IVec3,
    detail: Option<&WaterMeshDetail>,
    view_visibility: Option<&ViewVisibility>,
) -> Option<WaterMeshBodySample> {
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut surface_cells: Vec<(i32, i32, i32, usize)> = Vec::new();
    let mut y_counts: HashMap<i32, usize> = HashMap::new();
    let mut max_depth = detail.map(|detail| detail.max_depth).unwrap_or(0);
    let mut total_depth = 0usize;

    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            for y in (0..CHUNK_SIZE_I32).rev() {
                let world_pos = chunk_origin + IVec3::new(x, y, z);
                let VoxelSample::InBounds(voxel) = world.sample_voxel_for_water_meshing(world_pos)
                else {
                    continue;
                };
                if !voxel.is_liquid() {
                    continue;
                }
                if matches!(
                    world.sample_voxel_for_water_meshing(world_pos + IVec3::Y),
                    VoxelSample::InBounds(above) if above.is_liquid()
                ) {
                    continue;
                }

                let mut depth = 1usize;
                loop {
                    let below_pos = world_pos - IVec3::Y * depth as i32;
                    match world.sample_voxel_for_water_meshing(below_pos) {
                        VoxelSample::InBounds(v) if v.is_liquid() => depth += 1,
                        _ => break,
                    }
                }
                max_depth = max_depth.max(depth);
                total_depth += depth;
                surface_cells.push((x, z, world_pos.y, depth));
                *y_counts.entry(world_pos.y).or_default() += 1;
                break;
            }
        }
    }

    if surface_cells.is_empty() {
        return detail.map(|detail| WaterMeshBodySample {
            entity,
            chunk_pos,
            surface_y: WATER_LEVEL,
            surface_area: detail
                .surface_area
                .max(detail.triangle_count as f32 * 0.5)
                .max(1.0),
            max_depth: detail.max_depth,
            average_depth: if detail.average_depth > 0.0 {
                detail.average_depth
            } else {
                detail.max_depth as f32
            },
            aabb_min: transform.translation,
            aabb_max: transform.translation + Vec3::splat(CHUNK_SIZE_F32),
            touches_world_edge: chunk_touches_world_edge(world, chunk_pos),
            view_visible: view_visibility.is_some_and(|visibility| visibility.get()),
            edge_north: 0,
            edge_south: 0,
            edge_west: 0,
            edge_east: 0,
        });
    }

    let surface_y = y_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(y, _)| y)
        .unwrap_or(WATER_LEVEL);

    let mut edge_north = 0;
    let mut edge_south = 0;
    let mut edge_west = 0;
    let mut edge_east = 0;
    for (x, z, y, _) in &surface_cells {
        if *y != surface_y {
            continue;
        }
        if *z == 0 {
            edge_north |= water_body_edge_bit(*x);
        }
        if *z == CHUNK_SIZE_I32 - 1 {
            edge_south |= water_body_edge_bit(*x);
        }
        if *x == 0 {
            edge_west |= water_body_edge_bit(*z);
        }
        if *x == CHUNK_SIZE_I32 - 1 {
            edge_east |= water_body_edge_bit(*z);
        }
    }

    let surface_area = surface_cells.len() as f32;
    Some(WaterMeshBodySample {
        entity,
        chunk_pos,
        surface_y,
        surface_area,
        max_depth,
        average_depth: if surface_cells.is_empty() {
            0.0
        } else {
            total_depth as f32 / surface_cells.len() as f32
        },
        aabb_min: transform.translation,
        aabb_max: transform.translation + Vec3::splat(CHUNK_SIZE_F32),
        touches_world_edge: chunk_touches_world_edge(world, chunk_pos),
        view_visible: view_visibility.is_some_and(|visibility| visibility.get()),
        edge_north,
        edge_south,
        edge_west,
        edge_east,
    })
}

fn water_body_edge_bit(edge_cell: i32) -> WaterBodyEdgeMask {
    if (0..CHUNK_SIZE_I32).contains(&edge_cell) {
        1u32 << edge_cell as u32
    } else {
        0
    }
}

fn build_water_body_groups(
    samples: &[WaterMeshBodySample],
    world: &VoxelWorld,
    camera_pos: Option<Vec3>,
    previous_modes: &HashMap<WaterBodyId, WaterBodyMaterialMode>,
) -> Vec<WaterBodyGroup> {
    let mut index_by_chunk = HashMap::new();
    for (index, sample) in samples.iter().enumerate() {
        index_by_chunk.insert(sample.chunk_pos, index);
    }

    let mut visited = vec![false; samples.len()];
    let mut groups = Vec::new();
    for start in 0..samples.len() {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let mut queue = VecDeque::from([start]);
        let mut indices = Vec::new();

        while let Some(index) = queue.pop_front() {
            indices.push(index);
            for neighbor in water_body_neighbors(index, samples, &index_by_chunk)
                .into_iter()
                .flatten()
            {
                if visited[neighbor] {
                    continue;
                }
                visited[neighbor] = true;
                queue.push_back(neighbor);
            }
        }

        groups.push(build_water_body_group(
            &indices,
            samples,
            world,
            camera_pos,
            previous_modes,
        ));
    }

    groups
}

fn water_body_neighbors(
    index: usize,
    samples: &[WaterMeshBodySample],
    index_by_chunk: &HashMap<IVec3, usize>,
) -> [Option<usize>; 4] {
    let sample = &samples[index];
    let candidates = [
        (
            sample.chunk_pos + IVec3::X,
            sample.edge_east,
            WaterBodyEdge::West,
        ),
        (
            sample.chunk_pos + IVec3::NEG_X,
            sample.edge_west,
            WaterBodyEdge::East,
        ),
        (
            sample.chunk_pos + IVec3::Z,
            sample.edge_south,
            WaterBodyEdge::North,
        ),
        (
            sample.chunk_pos + IVec3::NEG_Z,
            sample.edge_north,
            WaterBodyEdge::South,
        ),
    ];

    let mut neighbors = [None; 4];
    for (slot, (chunk_pos, edge, neighbor_edge)) in candidates.into_iter().enumerate() {
        let Some(&neighbor_index) = index_by_chunk.get(&chunk_pos) else {
            continue;
        };
        let neighbor = &samples[neighbor_index];
        if sample.surface_y != neighbor.surface_y {
            continue;
        }
        let other_edge = match neighbor_edge {
            WaterBodyEdge::North => neighbor.edge_north,
            WaterBodyEdge::South => neighbor.edge_south,
            WaterBodyEdge::West => neighbor.edge_west,
            WaterBodyEdge::East => neighbor.edge_east,
        };
        if edge & other_edge != 0 {
            neighbors[slot] = Some(neighbor_index);
        }
    }
    neighbors
}

enum WaterBodyEdge {
    North,
    South,
    West,
    East,
}

fn build_water_body_group(
    indices: &[usize],
    samples: &[WaterMeshBodySample],
    world: &VoxelWorld,
    camera_pos: Option<Vec3>,
    previous_modes: &HashMap<WaterBodyId, WaterBodyMaterialMode>,
) -> WaterBodyGroup {
    let mut entities = Vec::with_capacity(indices.len());
    let mut min_chunk = IVec3::splat(i32::MAX);
    let mut aabb_min = Vec3::splat(f32::INFINITY);
    let mut aabb_max = Vec3::splat(f32::NEG_INFINITY);
    let mut surface_area = 0.0;
    let mut max_depth = 0usize;
    let mut total_depth_weighted = 0.0;
    let mut touches_world_edge = false;
    let mut visible_chunks = 0u32;
    let mut surface_y = WATER_LEVEL;
    let mut nearest_distance = f32::INFINITY;

    for index in indices {
        let sample = &samples[*index];
        entities.push(sample.entity);
        min_chunk = min_chunk.min(sample.chunk_pos);
        aabb_min = aabb_min.min(sample.aabb_min);
        aabb_max = aabb_max.max(sample.aabb_max);
        surface_area += sample.surface_area;
        max_depth = max_depth.max(sample.max_depth);
        total_depth_weighted += sample.average_depth * sample.surface_area;
        touches_world_edge |= sample.touches_world_edge;
        visible_chunks += u32::from(sample.view_visible);
        surface_y = sample.surface_y;
        if let Some(pos) = camera_pos {
            nearest_distance =
                nearest_distance.min(distance_to_aabb_xz(pos, sample.aabb_min, sample.aabb_max));
        }
    }

    let id = stable_water_body_id(min_chunk, surface_y);
    let average_depth = if surface_area <= f32::EPSILON {
        0.0
    } else {
        total_depth_weighted / surface_area
    };
    let kind = classify_water_body(
        world,
        aabb_min,
        aabb_max,
        surface_area,
        max_depth,
        average_depth,
        touches_world_edge,
    );
    let previous = previous_modes
        .get(&id)
        .copied()
        .unwrap_or(WaterBodyMaterialMode::Unknown);
    let material_mode =
        water_body_material_mode(previous, nearest_distance, max_depth, surface_area, kind);

    WaterBodyGroup {
        id,
        entities,
        kind,
        aabb_min,
        aabb_max,
        surface_y,
        surface_area,
        max_depth,
        average_depth,
        nearest_distance,
        visible_chunks,
        material_mode,
    }
}

fn classify_water_body(
    world: &VoxelWorld,
    aabb_min: Vec3,
    aabb_max: Vec3,
    surface_area: f32,
    max_depth: usize,
    average_depth: f32,
    touches_world_edge: bool,
) -> WaterBodyKind {
    if touches_world_edge || surface_area >= WATER_BODY_OCEAN_MIN_AREA {
        return WaterBodyKind::Ocean;
    }

    let shallow_loaded_body = max_depth <= WATER_BODY_SHALLOW_FLOOD_MAX_DEPTH
        || average_depth <= WATER_BODY_SHALLOW_FLOOD_MAX_AVG_DEPTH;

    let extent = aabb_max - aabb_min;
    let long = extent.x.max(extent.z).max(1.0);
    let short = extent.x.min(extent.z).max(1.0);
    if !shallow_loaded_body
        && surface_area >= WATER_BODY_LAKE_MIN_AREA
        && long / short >= WATER_BODY_RIVER_ASPECT_RATIO
    {
        return WaterBodyKind::River;
    }

    let world_extent = world.world_size_chunks() * CHUNK_SIZE_I32;
    if aabb_min.x <= 0.0
        || aabb_min.z <= 0.0
        || aabb_max.x >= world_extent.x as f32
        || aabb_max.z >= world_extent.z as f32
    {
        WaterBodyKind::Ocean
    } else if shallow_loaded_body {
        WaterBodyKind::ShallowFlood
    } else if surface_area < WATER_BODY_POND_MAX_AREA {
        WaterBodyKind::Pond
    } else if max_depth >= WATER_BODY_LAKE_MIN_DEPTH
        && average_depth >= WATER_BODY_LAKE_MIN_AVG_DEPTH
        && surface_area >= WATER_BODY_LAKE_MIN_AREA
    {
        WaterBodyKind::Lake
    } else {
        WaterBodyKind::Pond
    }
}

fn forced_water_body_kind(name: &str) -> Option<WaterBodyKind> {
    let value = std::env::var(name).ok()?;
    match value.trim().to_ascii_lowercase().as_str() {
        "ocean" => Some(WaterBodyKind::Ocean),
        "lake" => Some(WaterBodyKind::Lake),
        "river" => Some(WaterBodyKind::River),
        "pond" => Some(WaterBodyKind::Pond),
        "shallow_flood" | "shallowflood" | "flood" => Some(WaterBodyKind::ShallowFlood),
        "unknown" => Some(WaterBodyKind::Unknown),
        _ => None,
    }
}

fn water_body_reflection_strength(
    kind: WaterBodyKind,
    max_depth: usize,
    water_config: Option<&WaterConfig>,
) -> f32 {
    if let Some(config) = water_config {
        return config.body_preset(kind).reflection_strength;
    }
    match kind {
        WaterBodyKind::Ocean => 0.85,
        WaterBodyKind::Lake => 0.76,
        WaterBodyKind::River => 0.58,
        WaterBodyKind::Pond => {
            if max_depth <= 2 {
                0.62
            } else {
                0.7
            }
        }
        WaterBodyKind::ShallowFlood => 0.08,
        WaterBodyKind::Unknown => 0.72,
    }
}

fn water_body_fresnel_power(kind: WaterBodyKind, water_config: Option<&WaterConfig>) -> f32 {
    if let Some(config) = water_config {
        return config.body_preset(kind).fresnel_power;
    }
    match kind {
        WaterBodyKind::Ocean => 5.0,
        WaterBodyKind::Lake => 4.5,
        WaterBodyKind::River => 4.0,
        WaterBodyKind::Pond => 4.0,
        WaterBodyKind::ShallowFlood => 3.0,
        WaterBodyKind::Unknown => 4.5,
    }
}

fn water_body_distortion_strength(kind: WaterBodyKind, water_config: Option<&WaterConfig>) -> f32 {
    if let Some(config) = water_config {
        return config.body_preset(kind).distortion_strength;
    }
    match kind {
        WaterBodyKind::Ocean => 0.006,
        WaterBodyKind::Lake => 0.0045,
        WaterBodyKind::River => 0.008,
        WaterBodyKind::Pond => 0.0035,
        WaterBodyKind::ShallowFlood => 0.001,
        WaterBodyKind::Unknown => 0.0045,
    }
}

fn water_body_material_mode(
    previous: WaterBodyMaterialMode,
    nearest_distance: f32,
    max_depth: usize,
    surface_area: f32,
    _kind: WaterBodyKind,
) -> WaterBodyMaterialMode {
    if env_flag("VOXEL_FORCE_ALL_WATER_CHEAP") {
        return WaterBodyMaterialMode::Cheap;
    }
    if env_flag("VOXEL_FORCE_ALL_WATER_FANCY") {
        return WaterBodyMaterialMode::Fancy;
    }
    if surface_area < WATER_FANCY_MIN_TRIANGLES as f32 || max_depth < WATER_FANCY_MIN_DEPTH {
        return WaterBodyMaterialMode::Cheap;
    }

    let fancy_in = (WATER_FANCY_DISTANCE - WATER_FANCY_HYSTERESIS).max(0.0);
    let fancy_out = WATER_FANCY_DISTANCE + WATER_FANCY_HYSTERESIS;
    match previous {
        WaterBodyMaterialMode::Fancy if nearest_distance <= fancy_out => {
            WaterBodyMaterialMode::Fancy
        }
        WaterBodyMaterialMode::Fancy => WaterBodyMaterialMode::Cheap,
        WaterBodyMaterialMode::Cheap if nearest_distance < fancy_in => WaterBodyMaterialMode::Fancy,
        WaterBodyMaterialMode::Cheap => WaterBodyMaterialMode::Cheap,
        _ if nearest_distance <= WATER_FANCY_DISTANCE => WaterBodyMaterialMode::Fancy,
        _ => WaterBodyMaterialMode::Cheap,
    }
}

fn stable_water_body_id(min_chunk: IVec3, surface_y: i32) -> WaterBodyId {
    let mut hash = 2_166_136_261u32;
    for value in [min_chunk.x, min_chunk.y, min_chunk.z, surface_y] {
        hash ^= value as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    WaterBodyId(hash.max(1))
}

fn chunk_touches_world_edge(world: &VoxelWorld, chunk_pos: IVec3) -> bool {
    let size = world.world_size_chunks();
    chunk_pos.x <= 0 || chunk_pos.z <= 0 || chunk_pos.x >= size.x - 1 || chunk_pos.z >= size.z - 1
}

fn distance_to_aabb_xz(position: Vec3, min: Vec3, max: Vec3) -> f32 {
    let dx = if position.x < min.x {
        min.x - position.x
    } else if position.x > max.x {
        position.x - max.x
    } else {
        0.0
    };
    let dz = if position.z < min.z {
        min.z - position.z
    } else if position.z > max.z {
        position.z - max.z
    } else {
        0.0
    };
    Vec2::new(dx, dz).length()
}

fn record_water_body_counters(
    frame: u32,
    timing: &mut AreaTimingRecorder,
    registry: &WaterBodyRegistry,
) {
    timing.record_count(frame, "Water Bodies Total", registry.total as f64);
    timing.record_count(frame, "Water Bodies Ocean", registry.ocean as f64);
    timing.record_count(frame, "Water Bodies Lake", registry.lake as f64);
    timing.record_count(frame, "Water Bodies River", registry.river as f64);
    timing.record_count(frame, "Water Bodies Pond", registry.pond as f64);
    timing.record_count(
        frame,
        "Water Bodies ShallowFlood",
        registry.shallow_flood as f64,
    );
    timing.record_count(frame, "Water Body Fancy Count", registry.fancy_count as f64);
    timing.record_count(frame, "Water Body Cheap Count", registry.cheap_count as f64);
    timing.record_count(
        frame,
        "Water Body Material Switches",
        registry.material_switches as f64,
    );
}

fn update_water_material_lod(
    time: Res<Time>,
    frame: Res<FrameCount>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    water_material: Res<WaterMaterial>,
    mut registry: ResMut<WaterBodyRegistry>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut commands: Commands,
    water_meshes: Query<
        (
            Entity,
            &Transform,
            Option<&MeshMaterial3d<StandardWaterMaterial>>,
            Option<&MeshMaterial3d<StandardMaterial>>,
            Option<&WaterMeshDetail>,
            Option<&WaterBodyId>,
            Option<&Visibility>,
        ),
        With<WaterMesh>,
    >,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if *last_update > 0.0 && now - *last_update < WATER_MATERIAL_UPDATE_INTERVAL {
        timing.record_count(
            frame.0,
            "Water Chunks Forced Consistent By Body",
            registry.chunks_forced_consistent as f64,
        );
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        timing.record_count(
            frame.0,
            "Water Chunks Forced Consistent By Body",
            registry.chunks_forced_consistent as f64,
        );
        return;
    };

    let camera_pos = camera_transform.translation;
    let force_fancy = env_flag("VOXEL_FORCE_ALL_WATER_FANCY");
    let force_cheap = env_flag("VOXEL_FORCE_ALL_WATER_CHEAP");
    let fancy_in = (WATER_FANCY_DISTANCE - WATER_FANCY_HYSTERESIS).max(0.0);
    let fancy_out = WATER_FANCY_DISTANCE + WATER_FANCY_HYSTERESIS;
    let fancy_in_sq = fancy_in * fancy_in;
    let fancy_out_sq = fancy_out * fancy_out;
    let fancy_distance_sq = WATER_FANCY_DISTANCE * WATER_FANCY_DISTANCE;
    registry.chunks_forced_consistent = 0;

    for (entity, transform, fancy_mat, cheap_mat, detail, body_id, visibility) in
        water_meshes.iter()
    {
        let fallback_kind = body_id
            .and_then(|id| registry.bodies.get(id).map(|body| body.kind))
            .unwrap_or(WaterBodyKind::Unknown);
        let body_mode_kind = body_id.and_then(|id| {
            registry
                .bodies
                .get(id)
                .map(|body| (body.material_mode, body.kind))
        });
        let desired_visibility = desired_water_visibility(
            force_cheap,
            force_fancy,
            body_mode_kind.map(|(mode, _)| mode),
        );
        if !water_visibility_matches(visibility, desired_visibility) {
            commands.entity(entity).insert(desired_visibility);
        }
        if force_cheap {
            let desired = water_material.far_handle_for_kind(fallback_kind);
            if !standard_material_matches(cheap_mat, &desired) {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(desired))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
            continue;
        }
        if force_fancy {
            let desired = water_material.near_handle_for_kind(fallback_kind);
            if !standard_water_material_matches(fancy_mat, &desired) {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(desired))
                    .remove::<MeshMaterial3d<StandardMaterial>>();
            }
            continue;
        }
        if let Some((body_mode, body_kind)) = body_mode_kind {
            match body_mode {
                WaterBodyMaterialMode::Fancy => {
                    let desired = water_material.near_handle_for_kind(body_kind);
                    if !standard_water_material_matches(fancy_mat, &desired) {
                        registry.chunks_forced_consistent += 1;
                        commands
                            .entity(entity)
                            .insert(MeshMaterial3d(desired))
                            .remove::<MeshMaterial3d<StandardMaterial>>();
                    }
                }
                WaterBodyMaterialMode::Cheap | WaterBodyMaterialMode::Unknown => {
                    let desired = water_material.far_handle_for_kind(body_kind);
                    if !standard_material_matches(cheap_mat, &desired) {
                        registry.chunks_forced_consistent += 1;
                        commands
                            .entity(entity)
                            .insert(MeshMaterial3d(desired))
                            .remove::<MeshMaterial3d<StandardWaterMaterial>>();
                    }
                }
                WaterBodyMaterialMode::Hidden => {}
            }
            continue;
        }

        let allow_fancy_water = detail
            .map(|detail| {
                detail.triangle_count >= WATER_FANCY_MIN_TRIANGLES
                    && detail.max_depth >= WATER_FANCY_MIN_DEPTH
            })
            .unwrap_or(true);
        let chunk_center = transform.translation + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let dist_sq = chunk_center.distance_squared(camera_pos);

        if !allow_fancy_water {
            let desired = water_material.far_handle_for_kind(WaterBodyKind::Unknown);
            if !standard_material_matches(cheap_mat, &desired) {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(desired))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
            continue;
        }

        if fancy_mat.is_some() {
            if dist_sq > fancy_out_sq {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(
                        water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                    ))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
        } else if cheap_mat.is_some() {
            if dist_sq < fancy_in_sq {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(
                        water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                    ))
                    .remove::<MeshMaterial3d<StandardMaterial>>();
            }
        } else {
            if dist_sq <= fancy_distance_sq {
                commands.entity(entity).insert(MeshMaterial3d(
                    water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                ));
            } else {
                commands.entity(entity).insert(MeshMaterial3d(
                    water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                ));
            }
        }
    }
    timing.record_count(
        frame.0,
        "Water Chunks Forced Consistent By Body",
        registry.chunks_forced_consistent as f64,
    );
}

fn desired_water_visibility(
    force_cheap: bool,
    force_fancy: bool,
    body_mode: Option<WaterBodyMaterialMode>,
) -> Visibility {
    if force_cheap || force_fancy {
        return Visibility::Inherited;
    }
    match body_mode {
        Some(WaterBodyMaterialMode::Hidden) => Visibility::Hidden,
        _ => Visibility::Inherited,
    }
}

fn water_visibility_matches(current: Option<&Visibility>, desired: Visibility) -> bool {
    current.is_some_and(|current| *current == desired)
}

fn standard_water_material_matches(
    material: Option<&MeshMaterial3d<StandardWaterMaterial>>,
    desired: &Handle<StandardWaterMaterial>,
) -> bool {
    material.is_some_and(|material| material.0.id() == desired.id())
}

fn standard_material_matches(
    material: Option<&MeshMaterial3d<StandardMaterial>>,
    desired: &Handle<StandardMaterial>,
) -> bool {
    material.is_some_and(|material| material.0.id() == desired.id())
}

fn draw_water_body_debug_overlay(
    overlay_state: Option<Res<crate::interaction::DebugOverlayState>>,
    runtime_debug: Option<Res<crate::runtime_commands::RuntimeViewportDebugState>>,
    registry: Res<WaterBodyRegistry>,
    water_meshes: Query<(&Transform, Option<&WaterBodyId>), With<WaterMesh>>,
    mut gizmos: Gizmos,
) {
    if !overlay_state.is_some_and(|state| state.visible)
        && !runtime_debug.is_some_and(|debug| debug.editor_controlled && debug.water_debug)
    {
        return;
    }

    for (transform, body_id) in &water_meshes {
        let (mode, kind) = body_id
            .and_then(|id| registry.bodies.get(id))
            .map(|body| (body.material_mode, body.kind))
            .unwrap_or((WaterBodyMaterialMode::Unknown, WaterBodyKind::Unknown));
        let color = water_body_debug_color(mode, kind);
        let center = transform.translation
            + Vec3::new(
                CHUNK_SIZE_F32 * 0.5,
                CHUNK_SIZE_F32 * 0.5,
                CHUNK_SIZE_F32 * 0.5,
            );
        let cuboid = Cuboid::new(CHUNK_SIZE_F32, CHUNK_SIZE_F32, CHUNK_SIZE_F32);
        gizmos.primitive_3d(&cuboid, Isometry3d::from_translation(center), color);
    }
}

fn water_body_debug_color(mode: WaterBodyMaterialMode, kind: WaterBodyKind) -> Color {
    match mode {
        WaterBodyMaterialMode::Fancy => Color::srgba(0.0, 0.85, 1.0, 0.65),
        WaterBodyMaterialMode::Cheap => Color::srgba(1.0, 0.75, 0.05, 0.65),
        WaterBodyMaterialMode::Hidden => Color::srgba(1.0, 0.1, 0.1, 0.75),
        WaterBodyMaterialMode::Unknown => match kind {
            WaterBodyKind::Ocean => Color::srgba(0.2, 0.4, 1.0, 0.55),
            WaterBodyKind::Lake => Color::srgba(0.1, 0.9, 0.4, 0.55),
            WaterBodyKind::River => Color::srgba(0.7, 0.3, 1.0, 0.55),
            WaterBodyKind::Pond => Color::srgba(0.9, 0.9, 0.2, 0.55),
            WaterBodyKind::ShallowFlood => Color::srgba(1.0, 0.1, 0.05, 0.55),
            WaterBodyKind::Unknown => Color::srgba(1.0, 1.0, 1.0, 0.45),
        },
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct WaterChunkDepthDetail {
    max_depth: usize,
    average_depth: f32,
    surface_area: f32,
}

fn compute_water_chunk_depth_detail(world: &VoxelWorld, chunk_pos: IVec3) -> WaterChunkDepthDetail {
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut max_depth = 0usize;
    let mut total_depth = 0usize;
    let mut surface_area = 0usize;

    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            for y in (0..CHUNK_SIZE_I32).rev() {
                let world_pos = chunk_origin + IVec3::new(x, y, z);
                let VoxelSample::InBounds(voxel) = world.sample_voxel_for_water_meshing(world_pos)
                else {
                    continue;
                };
                if !voxel.is_liquid() {
                    continue;
                }

                if matches!(
                    world.sample_voxel_for_water_meshing(world_pos + IVec3::Y),
                    VoxelSample::InBounds(v) if v.is_liquid()
                ) {
                    continue;
                }

                let mut depth = 1usize;
                loop {
                    let below_pos = world_pos - IVec3::Y * depth as i32;
                    match world.sample_voxel_for_water_meshing(below_pos) {
                        VoxelSample::InBounds(v) if v.is_liquid() => {
                            depth += 1;
                        }
                        _ => break,
                    }
                }

                if depth > max_depth {
                    max_depth = depth;
                }
                total_depth += depth;
                surface_area += 1;
                break;
            }
        }
    }

    WaterChunkDepthDetail {
        max_depth,
        average_depth: if surface_area == 0 {
            0.0
        } else {
            total_depth as f32 / surface_area as f32
        },
        surface_area: surface_area as f32,
    }
}

/// Adjusts LOD settings for integrated GPUs to maintain performance.
///
/// This system runs once at startup and reduces view distances when an
/// integrated GPU is detected.
fn adjust_lod_for_integrated_gpu(
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut lod_settings: ResMut<LodSettings>,
    _mesh_settings: ResMut<MeshSettings>,
    mut applied: Local<bool>,
) {
    if *applied {
        return;
    }

    let Some(capabilities) = capabilities else {
        return;
    };

    if capabilities.adapter_name.is_none() {
        return;
    }

    if capabilities.integrated_gpu {
        lod_settings.high_detail_distance = INTEGRATED_GPU_HIGH_DETAIL_DISTANCE;
        lod_settings.cull_distance = INTEGRATED_GPU_CULL_DISTANCE;
        lod_settings.clamp_distance_bands();
        lod_settings.low_detail_mode = MeshMode::Blocky;
        // Keep mesh_settings.mode as SurfaceNets for nearby chunks (V0.3 triplanar PBR look)
        // Only distant LOD chunks use Blocky mode for performance
        info!(
            "Integrated GPU detected; using more aggressive LOD distances, keeping SurfaceNets for nearby terrain."
        );
    }

    *applied = true;
}

/// Runtime hysteresis for terrain LOD switching. Scales down with
/// `high_detail_distance` so a small near-band doesn't trap chunks at low LOD,
/// and is hard-capped at 8 voxels so transitions can never stretch beyond half
/// a chunk's worth of distance.
pub(crate) fn terrain_lod_hysteresis(settings: &LodSettings) -> f32 {
    terrain_lod_hysteresis_for(settings.high_detail_distance)
}

pub(crate) fn terrain_lod_hysteresis_for(high_detail_distance: f32) -> f32 {
    TERRAIN_LOD_HYSTERESIS
        .min(high_detail_distance * 0.25)
        .min(8.0)
}

/// Calculates the target LOD level with hysteresis to prevent rapid switching.
///
/// The target is the distance band directly — a chunk that loads far away
/// reaches Lod2/Lod3 in a single update instead of climbing one rung per
/// update. The old one-rung state machine, combined with the per-update change
/// cap, left distant chunks stuck at Lod0/Lod1.
///
/// Hysteresis is asymmetric: upgrades to higher detail fire eagerly (no `-h`
/// buffer) so a chunk that crosses a near threshold sharpens immediately.
/// Coarsening still needs to exceed `threshold + h` to prevent flip-flopping.
pub(crate) fn calculate_target_lod_with_hysteresis(
    distance: f32,
    current_lod: LodLevel,
    settings: &LodSettings,
) -> LodLevel {
    debug_assert!(
        settings.has_valid_distance_bands(),
        "LOD settings require cull_distance ({}) > high_detail_distance ({}) + 4 * TERRAIN_LOD_HYSTERESIS ({})",
        settings.cull_distance,
        settings.high_detail_distance,
        TERRAIN_LOD_HYSTERESIS
    );

    let h = terrain_lod_hysteresis(settings);

    // Distance thresholds for LOD transitions
    // Lod0: 0 to high_detail_distance
    // Lod1: high_detail_distance to lod1_distance (midpoint to cull)
    // Lod2+: lod1_distance to cull_distance
    let lod1_distance = (settings.high_detail_distance + settings.cull_distance) * 0.5;
    let lod2_distance = lod1_distance + (settings.cull_distance - lod1_distance) * 0.5;

    // Coarsening thresholds: Lod0|1 at high_detail_distance, Lod1|2 at
    // lod1_distance, Lod2|3 at lod2_distance, Lod3|Culled at cull_distance.
    let thresholds = [
        settings.high_detail_distance,
        lod1_distance,
        lod2_distance,
        settings.cull_distance,
    ];

    // Rank 0..=4 == Lod0..=Culled: how many coarsening thresholds `distance`
    // has cleared. `offset` shifts every threshold outward.
    let band = |offset: f32| -> u8 {
        thresholds
            .iter()
            .filter(|threshold| distance >= **threshold + offset)
            .count() as u8
    };

    // Asymmetric hysteresis: a chunk may sharpen eagerly (plain thresholds) but
    // only coarsens once it clears `threshold + h`. While the current LOD is
    // inside `[lazy, eager]` it is kept; outside it the chunk jumps straight to
    // the correct band — so a freshly loaded distant chunk reaches Lod2/Lod3 in
    // one update instead of one rung per update.
    let eager = band(0.0);
    let lazy = band(h);
    let current_rank = 4 - current_lod.detail_value();
    let target_rank = current_rank.clamp(lazy, eager);

    match target_rank {
        0 => LodLevel::Lod0,
        1 => LodLevel::Lod1,
        2 => LodLevel::Lod2,
        3 => LodLevel::Lod3,
        _ => LodLevel::Culled,
    }
}

// =============================================================================
// Visibility Optimization Systems
// =============================================================================

/// Updates face visibility for chunks that have been modified.
///
/// This computes the 15-bit connectivity mask indicating which chunk faces
/// can see each other through air voxels. Used by the BFS occlusion system.
fn update_chunk_face_visibility_system(
    mut world: ResMut<VoxelWorld>,
    config: Res<OcclusionConfig>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Face Visibility");
    // Skip when occlusion culling is disabled — results are not consumed
    if !config.enabled {
        return;
    }

    // Collect positions of chunks needing visibility update
    let dirty_positions: Vec<IVec3> = world
        .chunk_entries()
        .filter(|(_, chunk)| chunk.is_visibility_dirty())
        .map(|(pos, _)| *pos)
        .collect();

    for pos in dirty_positions {
        if let Some(mut chunk) = world.get_chunk_mut(pos) {
            // Ensure uniformity is computed first (needed by visibility algorithm)
            chunk.compute_uniformity();
            let visibility = compute_face_visibility(&chunk);
            chunk.set_face_visibility(visibility);
            chunk.clear_visibility_dirty();
        }
    }
}

/// Rebuilds the chunk octree when chunks have been added or removed.
///
/// The octree enables O(log N) frustum culling instead of checking every chunk.
fn update_octree_system(
    world: Res<VoxelWorld>,
    mut octree: ResMut<ChunkOctree>,
    gen_state: Res<ChunkGenerationState>,
    config: Res<OcclusionConfig>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Octree Rebuild");
    // Skip when occlusion culling is disabled — octree is only used by culling
    if !config.enabled {
        return;
    }

    // Don't rebuild during initial world generation
    if !gen_state.is_complete {
        return;
    }

    // Build octree if dirty or not yet built
    if octree.is_dirty() || !octree.is_built() {
        octree.build(&world);
    }
}

/// Applies enclosure-only visibility culling to terrain chunk meshes.
pub fn apply_visibility_culling_system(
    config: Res<OcclusionConfig>,
    visible_chunks: Res<VisibleChunks>,
    mut stats: ResMut<EnclosureOcclusionStats>,
    mut chunk_meshes: Query<(&ChunkMesh, &mut Visibility)>,
    mut was_enabled: Local<bool>,
) {
    if !config.enabled {
        if *was_enabled {
            for (_, mut visibility) in &mut chunk_meshes {
                if *visibility == Visibility::Hidden {
                    *visibility = Visibility::Inherited;
                }
            }
            stats.hidden_chunks = 0;
            stats.total_chunks = 0;
            *was_enabled = false;
        }
        return;
    }

    *was_enabled = true;
    stats.hidden_chunks = 0;
    stats.total_chunks = 0;

    for (chunk_mesh, mut visibility) in &mut chunk_meshes {
        let is_visible = visible_chunks.is_visible(chunk_mesh.chunk_position);
        let target = if is_visible {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        if *visibility != target {
            *visibility = target;
        }
        stats.total_chunks += 1;
        if !is_visible {
            stats.hidden_chunks += 1;
        }
    }
}

// =============================================================================
// LOD System
// =============================================================================

/// Updates the LOD level of each chunk based on distance from the camera.
///
/// Chunks are assigned to one of three LOD levels:
/// - `High`: Close to camera, uses full detail meshing
/// - `Low`: Medium distance, uses simplified meshing
/// - `Culled`: Far away, not rendered at all
///
/// Uses hysteresis to prevent rapid LOD switching when camera is near thresholds.
/// Throttled to every 0.25s. Stationary scans run only while new chunks arrive
/// or prior LOD work is still draining, so chunks can converge after loading
/// without paying a permanent full-world scan cost.
pub(crate) fn terrain_lod_distance_xz(chunk_pos: IVec3, camera_pos: Vec3) -> f32 {
    let world_pos = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec2::new(
        world_pos.x as f32 + CHUNK_SIZE_F32 * 0.5,
        world_pos.z as f32 + CHUNK_SIZE_F32 * 0.5,
    );

    chunk_center.distance(Vec2::new(camera_pos.x, camera_pos.z))
}

fn update_chunk_lod_system(
    mut world: ResMut<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    lod_settings: Res<LodSettings>,
    bench_forensics: Option<Res<BenchForensicsConfig>>,
    mc_spike: McSpikeMeshParams,
    lod_control: Res<TerrainLodControl>,
    mut lod_transitions: ResMut<TerrainLodTransitionState>,
    time: Res<Time>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut last_update: Local<f32>,
    mut last_camera_pos: Local<Option<Vec3>>,
    mut last_chunk_count: Local<Option<usize>>,
    mut stationary_lod_scans_remaining: Local<u8>,
) {
    let _timer = area_timer(&mut timing, frame.0, "LOD Update");
    lod_transitions.repeated_chunks_this_frame = 0;
    if lod_control.freeze_lod {
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }

    // Throttle to ~4Hz (every 0.25s)
    let now = time.elapsed_secs();
    if now - *last_update < 0.25 {
        refresh_lod_change_rate(now, &mut lod_transitions);
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        refresh_lod_change_rate(now, &mut lod_transitions);
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    };

    let camera_pos = camera_transform.translation;
    let chunk_count = world.chunk_entries().count();
    let camera_moved = last_camera_pos
        .map(|prev| camera_pos.distance_squared(prev) >= 4.0)
        .unwrap_or(true);
    let chunk_count_changed = last_chunk_count
        .map(|previous| previous != chunk_count)
        .unwrap_or(true);
    if !camera_moved && !chunk_count_changed && *stationary_lod_scans_remaining == 0 {
        *last_update = now;
        refresh_lod_change_rate(now, &mut lod_transitions);
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }

    *last_update = now;
    *last_camera_pos = Some(camera_pos);
    *last_chunk_count = Some(chunk_count);

    let water_lod_guard_chunks = collect_water_shore_lod_guard_chunks(&world);
    let water_lod_guard_count = water_lod_guard_chunks.len() as f64;

    // Pass 1 — compute each chunk's hysteresis/water-guarded desired LOD.
    let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
    let mut chunk_state: HashMap<IVec3, (LodLevel, f32)> = HashMap::new();
    for (chunk_pos, chunk) in world.chunk_entries() {
        let distance = terrain_lod_distance_xz(*chunk_pos, camera_pos);
        let current_lod = chunk.lod_level();
        let target_lod = forensics_forced_lod(bench_forensics.as_deref()).unwrap_or_else(|| {
            water_shore_guarded_lod(
                calculate_target_lod_with_hysteresis(distance, current_lod, &lod_settings),
                distance,
                &lod_settings,
                water_lod_guard_chunks.contains(chunk_pos),
            )
        });
        desired.insert(*chunk_pos, target_lod);
        chunk_state.insert(*chunk_pos, (current_lod, distance));
    }

    // Pass 2 — LOD coherence. A chunk that is coarser than every loaded
    // face-neighbour is an isolated LOD island, and an island carries up to six
    // LOD-boundary cracks around it. Pull any such island up to match its
    // coarsest face-neighbour so LOD stays spatially coherent.
    const FACE_OFFSETS: [IVec3; 6] = [
        IVec3::new(1, 0, 0),
        IVec3::new(-1, 0, 0),
        IVec3::new(0, 1, 0),
        IVec3::new(0, -1, 0),
        IVec3::new(0, 0, 1),
        IVec3::new(0, 0, -1),
    ];
    for _ in 0..LOD_COHERENCE_PASSES {
        let mut updates: Vec<(IVec3, LodLevel)> = Vec::new();
        for (chunk_pos, &lod) in &desired {
            let mut coarsest_neighbor: Option<LodLevel> = None;
            let mut is_island = true;
            for offset in FACE_OFFSETS {
                let Some(&neighbor_lod) = desired.get(&(*chunk_pos + offset)) else {
                    continue;
                };
                if let Some(upgraded_lod) =
                    lod_upgrade_for_face_neighbor_coherence(lod, neighbor_lod)
                {
                    updates.push((*chunk_pos, upgraded_lod));
                    break;
                }
                if !lod.is_lower_detail_than(neighbor_lod) {
                    is_island = false;
                }
                coarsest_neighbor = Some(match coarsest_neighbor {
                    Some(coarsest) if !neighbor_lod.is_lower_detail_than(coarsest) => coarsest,
                    _ => neighbor_lod,
                });
            }
            if is_island {
                if let Some(target) = coarsest_neighbor {
                    updates.push((*chunk_pos, target));
                }
            }
        }
        if updates.is_empty() {
            break;
        }
        for (pos, lod) in updates {
            desired.insert(pos, lod);
        }
    }

    let forced_by_max_one = if mc_spike.settings.enabled
        && mc_spike.settings.lod_delta_policy == McTransvoxelLodDeltaPolicy::MaxOne
    {
        enforce_lod_delta_max_one(&mut desired)
    } else {
        HashSet::new()
    };

    // Pass 3 — turn coherent desired LODs into change candidates.
    // 5th tuple element flags max_one-forced changes for prioritized handling.
    let mut lod_candidates: Vec<(IVec3, LodLevel, LodLevel, f32, bool)> = Vec::new();
    for (chunk_pos, &target_lod) in &desired {
        let Some(&(current_lod, distance)) = chunk_state.get(chunk_pos) else {
            continue;
        };
        if target_lod == current_lod {
            continue;
        }
        let cooldown_elapsed = lod_transitions
            .last_change_frame
            .get(chunk_pos)
            .map(|last_frame| frame.0.saturating_sub(*last_frame) >= LOD_CHANGE_COOLDOWN_FRAMES)
            .unwrap_or(true);
        // Cooldown only throttles downgrades; upgrades to higher detail must
        // not be punished or stale LOD states can persist during movement.
        // Coherence-forced refinements (from `enforce_lod_delta_max_one`) also
        // bypass cooldown; without this, max-one bumps sit blocked for 30
        // frames while the user walks, leaving Lod0-Lod2 deltas the
        // MC+Transvoxel apron cannot bridge (visible as a horizontal band
        // of holes along the LOD seam that drifts as the camera moves).
        let is_upgrade = target_lod.is_higher_detail_than(current_lod);
        let is_max_one_forced = forced_by_max_one.contains(chunk_pos);
        if !is_upgrade && !cooldown_elapsed && !is_max_one_forced {
            continue;
        }
        lod_candidates.push((
            *chunk_pos,
            current_lod,
            target_lod,
            distance,
            is_max_one_forced,
        ));
    }

    lod_candidates.sort_by(|a, b| {
        // Forced max_one changes first (constraint-mandated; can't bake them in
        // later). Then upgrades (visual responsiveness during motion). Then by
        // closeness so what's near the camera updates ahead of far chunks.
        b.4.cmp(&a.4)
            .then_with(|| {
                let a_upgrade = a.2.is_higher_detail_than(a.1);
                let b_upgrade = b.2.is_higher_detail_than(b.1);
                b_upgrade.cmp(&a_upgrade)
            })
            .then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });

    let lod_candidate_count = lod_candidates.len();
    let mut lod_changed: Vec<IVec3> = Vec::new();
    let mut voluntary_count = 0usize;
    for (chunk_pos, _current_lod, target_lod, _distance, is_forced) in lod_candidates {
        // Voluntary changes throttled by MAX_LOD_CHANGES_PER_UPDATE to keep mesh
        // load smooth. Forced max_one changes are not optional — capping them
        // leaves chunks with delta>1 neighbours that the MC apron can't bridge,
        // recreating the horizontal band of holes that drifts as the camera
        // moves. Commit ALL forced changes regardless of cap.
        if !is_forced {
            if voluntary_count >= MAX_LOD_CHANGES_PER_UPDATE {
                continue;
            }
            voluntary_count += 1;
        }
        let Some(mut chunk) = world.get_chunk_mut(chunk_pos) else {
            continue;
        };
        if !chunk.set_lod_level(target_lod) {
            continue;
        }
        lod_transitions.last_change_frame.insert(chunk_pos, frame.0);
        let change_count = lod_transitions.change_count.entry(chunk_pos).or_insert(0);
        *change_count += 1;
        if *change_count > 1 {
            lod_transitions.repeated_chunks_this_frame += 1;
        }
        lod_changed.push(chunk_pos);
    }

    lod_transitions.changes_this_second += lod_changed.len() as u32;
    refresh_lod_change_rate(now, &mut lod_transitions);

    let lod_changed_count = lod_changed.len() as u32;
    if lod_candidate_count > lod_changed.len() || !lod_changed.is_empty() {
        *stationary_lod_scans_remaining = 1;
    } else {
        *stationary_lod_scans_remaining = 0;
    }
    for chunk_pos in &lod_changed {
        mark_chunk_lod_halo_dirty(&mut world, *chunk_pos);
    }

    if !lod_transitions.last_change_frame.is_empty() && frame.0 % 600 == 0 {
        lod_transitions
            .last_change_frame
            .retain(|_, last_frame| frame.0.saturating_sub(*last_frame) < 3_600);
        let active_change_frames = lod_transitions.last_change_frame.clone();
        lod_transitions
            .change_count
            .retain(|chunk_pos, _| active_change_frames.contains_key(chunk_pos));
    }
    let repeated_chunks_this_frame = lod_transitions.repeated_chunks_this_frame;
    let changes_per_second = lod_transitions.changes_per_second;
    drop(_timer);
    timing.record_count(
        frame.0,
        "Water Shore Terrain LOD Guard Chunks",
        water_lod_guard_count,
    );
    record_lod_counters(
        &mut timing,
        frame.0,
        lod_changed_count,
        changes_per_second,
        repeated_chunks_this_frame,
    );
}

pub(crate) fn collect_water_shore_lod_guard_chunks(world: &VoxelWorld) -> HashSet<IVec3> {
    let mut chunks = HashSet::new();
    for (chunk_pos, chunk) in world.chunk_entries() {
        if !chunk_contains_liquid(chunk) {
            continue;
        }
        // Softer ring: a diamond of L1 radius 2 in XZ around each water chunk, plus
        // one Y layer above/below. Prevents isolated lower-LOD islands at the
        // shoreline where SDF averaging diverges most.
        for dy in -1..=1 {
            for dz in -2i32..=2 {
                for dx in -2i32..=2 {
                    if dx.abs() + dz.abs() > 2 {
                        continue;
                    }
                    chunks.insert(*chunk_pos + IVec3::new(dx, dy, dz));
                }
            }
        }
    }
    // Any chunk whose Y range straddles the waterline is fragile even without
    // liquid voxels inside it; guard those too.
    for (chunk_pos, _) in world.chunk_entries() {
        if chunk_layer_intersects_waterline(*chunk_pos) {
            chunks.insert(*chunk_pos);
        }
    }
    chunks
}

fn max_lod_for_face_neighbor(neighbor_lod: LodLevel) -> LodLevel {
    match neighbor_lod {
        LodLevel::Lod0 => LodLevel::Lod1,
        LodLevel::Lod1 => LodLevel::Lod2,
        LodLevel::Lod2 => LodLevel::Lod3,
        LodLevel::Lod3 | LodLevel::Culled => LodLevel::Culled,
    }
}

fn lod_upgrade_for_face_neighbor_coherence(
    lod: LodLevel,
    neighbor_lod: LodLevel,
) -> Option<LodLevel> {
    let max_lod = max_lod_for_face_neighbor(neighbor_lod);
    lod.is_lower_detail_than(max_lod).then_some(max_lod)
}

fn chunk_layer_intersects_waterline(chunk_pos: IVec3) -> bool {
    let min_y = chunk_pos.y * CHUNK_SIZE_I32;
    let max_y = min_y + CHUNK_SIZE_I32 - 1;
    WATER_LEVEL >= min_y - 2 && WATER_LEVEL <= max_y + 2
}

fn chunk_contains_liquid(chunk: &Chunk) -> bool {
    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                if chunk
                    .get(UVec3::new(x as u32, y as u32, z as u32))
                    .is_liquid()
                {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn water_shore_guarded_lod(
    target_lod: LodLevel,
    distance: f32,
    settings: &LodSettings,
    water_shore_guarded: bool,
) -> LodLevel {
    if !water_shore_guarded || target_lod == LodLevel::Culled {
        return target_lod;
    }

    let guard_distance = settings.high_detail_distance + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA;
    if distance <= guard_distance {
        LodLevel::Lod0
    } else {
        target_lod
    }
}

fn record_lod_counters(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    changes: u32,
    changes_per_second: f32,
    repeated_chunks: u32,
) {
    timing.record_count(frame, "Terrain LOD Changes", changes as f64);
    timing.record_count(
        frame,
        "Terrain LOD Changes Per Second",
        changes_per_second as f64,
    );
    timing.record_count(frame, "Terrain LOD Repeated Chunks", repeated_chunks as f64);
}

fn refresh_lod_change_rate(now: f32, lod_transitions: &mut TerrainLodTransitionState) {
    if lod_transitions.last_change_second == 0.0 {
        lod_transitions.last_change_second = now;
        return;
    }
    if now - lod_transitions.last_change_second < 1.0 {
        return;
    }
    let elapsed = (now - lod_transitions.last_change_second).max(0.001);
    lod_transitions.changes_per_second = lod_transitions.changes_this_second as f32 / elapsed;
    lod_transitions.changes_this_second = 0;
    lod_transitions.last_change_second = now;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_face_lod_deltas_le_one(desired: &HashMap<IVec3, LodLevel>) {
        const FACE_OFFSETS: [IVec3; 3] = [
            IVec3::new(1, 0, 0),
            IVec3::new(0, 1, 0),
            IVec3::new(0, 0, 1),
        ];

        for (pos, lod) in desired {
            let Some(lod_idx) = lod.lod_index() else {
                continue;
            };
            for offset in FACE_OFFSETS {
                let Some(neighbor) = desired.get(&(*pos + offset)) else {
                    continue;
                };
                let Some(neighbor_idx) = neighbor.lod_index() else {
                    continue;
                };
                assert!(
                    lod_idx.abs_diff(neighbor_idx) <= 1,
                    "expected face-adjacent delta <= 1 for {pos:?} and {:?}, got {lod_idx} vs {neighbor_idx}",
                    *pos + offset
                );
            }
        }
    }

    /// `enforce_lod_delta_max_one` must (a) clamp deltas to 1 and (b) return
    /// the chunks it touched so pass-3 can bypass the LOD-change cooldown for
    /// those coherence-forced refinements. Without (b), the bumps sit blocked
    /// for 30 frames while the user walks, leaving the LOD0-LOD2 deltas the
    /// MC+Transvoxel apron can't bridge.
    #[test]
    fn enforce_lod_delta_max_one_returns_modified_chunks() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        desired.insert(IVec3::ZERO, LodLevel::Lod0);
        desired.insert(IVec3::new(1, 0, 0), LodLevel::Lod2);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert_face_lod_deltas_le_one(&desired);

        assert!(
            !forced.is_empty(),
            "enforce_lod_delta_max_one must report which chunks it modified"
        );
        // The modified chunk's desired LOD must differ from its starting LOD.
        let initial: HashMap<IVec3, LodLevel> = [
            (IVec3::ZERO, LodLevel::Lod0),
            (IVec3::new(1, 0, 0), LodLevel::Lod2),
        ]
        .into_iter()
        .collect();
        for pos in &forced {
            assert_ne!(
                desired[pos], initial[pos],
                "chunk reported as forced ({pos:?}) but its LOD is unchanged"
            );
        }
    }

    #[test]
    fn enforce_lod_delta_max_one_refines_coarser_side_only() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        let fine = IVec3::ZERO;
        let coarse = IVec3::new(1, 0, 0);
        desired.insert(fine, LodLevel::Lod0);
        desired.insert(coarse, LodLevel::Lod2);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert_eq!(
            desired[&fine],
            LodLevel::Lod0,
            "max-one enforcement must not coarsen the high-detail side"
        );
        assert_eq!(
            desired[&coarse],
            LodLevel::Lod1,
            "coarser neighbor should refine to the only bridgeable LOD"
        );
        assert_eq!(
            forced,
            HashSet::from([coarse]),
            "only the refined coarse chunk should bypass the cooldown"
        );
        assert_face_lod_deltas_le_one(&desired);
    }

    #[test]
    fn enforce_lod_delta_max_one_propagates_refinements_across_chain() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        let lod0 = IVec3::ZERO;
        let lod3_a = IVec3::new(1, 0, 0);
        let lod3_b = IVec3::new(2, 0, 0);
        desired.insert(lod0, LodLevel::Lod0);
        desired.insert(lod3_a, LodLevel::Lod3);
        desired.insert(lod3_b, LodLevel::Lod3);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert_eq!(desired[&lod0], LodLevel::Lod0);
        assert_eq!(desired[&lod3_a], LodLevel::Lod1);
        assert_eq!(desired[&lod3_b], LodLevel::Lod2);
        assert_eq!(forced, HashSet::from([lod3_a, lod3_b]));
        assert_face_lod_deltas_le_one(&desired);
    }

    #[test]
    fn enforce_lod_delta_max_one_no_modifications_returns_empty_set() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        desired.insert(IVec3::ZERO, LodLevel::Lod0);
        desired.insert(IVec3::new(1, 0, 0), LodLevel::Lod1);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert!(
            forced.is_empty(),
            "delta=1 fixture must not trigger any modifications"
        );
    }

    #[test]
    fn terrain_lod_hysteresis_caps_at_eight_voxels() {
        // At any practical high_detail_distance the runtime hysteresis is capped
        // at 8 voxels so a single LOD band can never exceed half a chunk.
        assert_eq!(terrain_lod_hysteresis_for(176.0), 8.0);
        assert_eq!(terrain_lod_hysteresis_for(1_000.0), 8.0);
    }

    #[test]
    fn terrain_lod_hysteresis_scales_down_for_small_distances() {
        // Below ~32 voxels the cap shrinks: hd * 0.25 dominates so the cap
        // never overruns the high-detail band itself.
        assert_eq!(terrain_lod_hysteresis_for(16.0), 4.0);
        assert_eq!(terrain_lod_hysteresis_for(8.0), 2.0);
        assert_eq!(terrain_lod_hysteresis_for(0.0), 0.0);
    }

    #[test]
    fn lod1_upgrades_eagerly_without_hysteresis_buffer() {
        // Asymmetric thresholds: Lod0 -> Lod1 still needs the buffer, but
        // Lod1 -> Lod0 snaps back the instant the chunk enters the high-detail
        // band. This prevents isolated lower-LOD islands near the camera.
        let settings = LodSettings::default();
        let h = terrain_lod_hysteresis(&settings);

        assert!(h > 0.0, "test pre-condition: hysteresis must be > 0");

        // Just outside hd-h: previously this kept Lod1, now upgrades.
        let just_inside = settings.high_detail_distance - 0.1;
        assert_eq!(
            calculate_target_lod_with_hysteresis(just_inside, LodLevel::Lod1, &settings),
            LodLevel::Lod0
        );

        // Exactly at hd: also upgrades (strict-less compare against hd).
        let at_threshold = settings.high_detail_distance;
        assert_eq!(
            calculate_target_lod_with_hysteresis(at_threshold, LodLevel::Lod1, &settings),
            LodLevel::Lod1
        );

        // Lod0 -> Lod1 downgrade still requires the full hysteresis buffer.
        let just_past_with_buffer = settings.high_detail_distance + h + 0.1;
        assert_eq!(
            calculate_target_lod_with_hysteresis(just_past_with_buffer, LodLevel::Lod0, &settings),
            LodLevel::Lod1
        );
        let in_buffer = settings.high_detail_distance + h - 0.1;
        assert_eq!(
            calculate_target_lod_with_hysteresis(in_buffer, LodLevel::Lod0, &settings),
            LodLevel::Lod0
        );
    }

    #[test]
    fn default_lod_distances_keep_required_hysteresis_bands() {
        assert!(LodSettings::default().has_valid_distance_bands());

        let integrated_gpu_settings = LodSettings {
            high_detail_distance: INTEGRATED_GPU_HIGH_DETAIL_DISTANCE,
            cull_distance: INTEGRATED_GPU_CULL_DISTANCE,
            low_detail_mode: MeshMode::Blocky,
        };
        assert!(integrated_gpu_settings.has_valid_distance_bands());
    }

    #[test]
    fn lod_distance_clamp_preserves_four_hysteresis_bands() {
        let hd = 120.0_f32;
        let mut settings = LodSettings {
            high_detail_distance: hd,
            cull_distance: hd + terrain_lod_hysteresis_for(hd) * 4.0,
            low_detail_mode: MeshMode::SurfaceNets,
        };

        // `has_valid_distance_bands` is a strict-greater check, so the
        // exact threshold value is rejected.
        assert!(!settings.has_valid_distance_bands());

        settings.clamp_distance_bands();

        assert!(settings.has_valid_distance_bands());
        assert!(
            settings.cull_distance
                > settings.high_detail_distance
                    + terrain_lod_hysteresis_for(settings.high_detail_distance) * 4.0
        );
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
    fn water_shore_lod_guard_keeps_water_chunk_and_neighbors_high_detail() {
        let settings = LodSettings::default();

        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Lod2,
                settings.high_detail_distance + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA - 1.0,
                &settings,
                true,
            ),
            LodLevel::Lod0
        );
        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Lod2,
                settings.high_detail_distance + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA + 1.0,
                &settings,
                true,
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Lod2,
                settings.high_detail_distance,
                &settings,
                false
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Culled,
                settings.high_detail_distance,
                &settings,
                true
            ),
            LodLevel::Culled
        );
    }

    #[test]
    fn lod_coherence_rejects_multi_step_face_jumps() {
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod2, LodLevel::Lod0),
            Some(LodLevel::Lod1)
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod3, LodLevel::Lod1),
            Some(LodLevel::Lod2)
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Culled, LodLevel::Lod2),
            Some(LodLevel::Lod3)
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod1, LodLevel::Lod0),
            None
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod0, LodLevel::Lod2),
            None
        );
    }

    #[test]
    fn water_shore_lod_guard_marks_diamond_ring_with_y_neighbors() {
        let center = IVec3::new(2, 1, 2);
        let mut world = VoxelWorld::new(IVec3::new(5, 3, 5));
        let mut chunk = Chunk::new(center);
        chunk.set(UVec3::new(8, 8, 8), VoxelType::Water);
        world.insert_chunk(chunk);

        let guarded = collect_water_shore_lod_guard_chunks(&world);

        // Radius-0 and radius-1 cross.
        assert!(guarded.contains(&center));
        assert!(guarded.contains(&(center + IVec3::X)));
        assert!(guarded.contains(&(center + IVec3::NEG_X)));
        assert!(guarded.contains(&(center + IVec3::Z)));
        assert!(guarded.contains(&(center + IVec3::NEG_Z)));
        // Diagonal neighbours (|dx|+|dz|=2) are inside the L1 diamond.
        assert!(guarded.contains(&(center + IVec3::new(1, 0, 1))));
        assert!(guarded.contains(&(center + IVec3::new(-1, 0, -1))));
        // Radius-2 cross is inside the diamond.
        assert!(guarded.contains(&(center + IVec3::new(2, 0, 0))));
        assert!(guarded.contains(&(center + IVec3::new(0, 0, -2))));
        // Outside the diamond (|dx|+|dz|=3) is NOT guarded.
        assert!(!guarded.contains(&(center + IVec3::new(2, 0, 1))));
        // One Y layer above/below IS guarded — softens vertical transitions
        // where shoreline geometry straddles a chunk Y boundary.
        assert!(guarded.contains(&(center + IVec3::Y)));
        assert!(guarded.contains(&(center + IVec3::NEG_Y)));
        // Two Y layers away is NOT guarded.
        assert!(!guarded.contains(&(center + IVec3::new(0, 2, 0))));
    }

    #[test]
    fn waterline_chunk_layer_is_guarded_without_liquid_voxels() {
        // Chunk at y=1 spans world Y=16..31; WATER_LEVEL=18 sits in that range.
        let chunk_pos = IVec3::new(0, 1, 0);
        assert!(chunk_layer_intersects_waterline(chunk_pos));

        let mut world = VoxelWorld::new(IVec3::new(1, 3, 1));
        let chunk = Chunk::new(chunk_pos);
        // No liquid voxels.
        world.insert_chunk(chunk);

        let guarded = collect_water_shore_lod_guard_chunks(&world);
        assert!(guarded.contains(&chunk_pos));
    }

    #[test]
    fn surface_nets_mesh_defers_when_in_bounds_halo_is_missing() {
        assert!(should_defer_surface_nets_mesh(MeshMode::SurfaceNets, 1));
        assert!(!should_defer_surface_nets_mesh(MeshMode::SurfaceNets, 0));
        assert!(!should_defer_surface_nets_mesh(MeshMode::Blocky, 1));
    }

    #[test]
    fn initial_lod_assignment_uses_distance_without_lod_dirty_reason() {
        let mut chunk = Chunk::new(IVec3::new(18, 0, 0));
        let lod_settings = LodSettings::default();
        let initial_lod = initial_lod_for_chunk(&chunk, Some(Vec3::ZERO), &lod_settings, None);

        assert!(initial_lod.is_lower_detail_than(LodLevel::Lod0));
        chunk.set_initial_lod_level(initial_lod);

        assert_eq!(chunk.lod_level(), initial_lod);
        assert!(chunk.has_dirty_reason(MeshDirtyReason::Generation));
        assert!(!chunk.has_dirty_reason(MeshDirtyReason::Lod));
    }

    #[test]
    fn generated_chunk_marks_full_3d_halo_dirty() {
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
        assert_eq!(dirty.len(), 26);
        assert!(!dirty.contains(&center));
        assert!(dirty.contains(&(center + IVec3::new(-1, -1, -1))));
        assert!(dirty.contains(&(center + IVec3::new(1, 1, 1))));
        assert!(dirty.contains(&(center + IVec3::Y)));
    }

    #[test]
    fn lod_change_marks_face_halo_dirty() {
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

        mark_chunk_lod_halo_dirty(&mut world, center);

        let dirty = world.dirty_chunks().collect::<HashSet<_>>();
        assert_eq!(dirty.len(), 6);
        assert!(!dirty.contains(&center));
        assert!(dirty.contains(&(center + IVec3::Y)));
        assert!(dirty.contains(&(center + IVec3::NEG_Y)));
        assert!(!dirty.contains(&(center + IVec3::new(1, 1, 0))));
        assert!(
            world
                .get_chunk(center + IVec3::Y)
                .is_some_and(|chunk| chunk.has_dirty_reason(MeshDirtyReason::NeighborLod))
        );
    }

    #[test]
    fn empty_surface_nets_cap_forces_lod0_sampling() {
        assert_eq!(
            mesh_lod_level_for_surface_nets_cap(
                MeshMode::SurfaceNets,
                ChunkUniformity::Empty,
                true,
                LodLevel::Lod3
            ),
            LodLevel::Lod0
        );
        assert_eq!(
            mesh_lod_level_for_surface_nets_cap(
                MeshMode::SurfaceNets,
                ChunkUniformity::Mixed,
                true,
                LodLevel::Lod3
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            mesh_lod_level_for_surface_nets_cap(
                MeshMode::Blocky,
                ChunkUniformity::Empty,
                true,
                LodLevel::Lod3
            ),
            LodLevel::Lod3
        );
    }

    #[test]
    fn terrain_lod_distance_ignores_chunk_height() {
        let camera_pos = Vec3::new(24.0, 128.0, 24.0);
        assert_eq!(
            terrain_lod_distance_xz(IVec3::new(1, 0, 1), camera_pos),
            terrain_lod_distance_xz(IVec3::new(1, 6, 1), camera_pos)
        );
    }

    #[test]
    fn neighbor_lods_use_effective_lod_for_empty_surface_nets_caps() {
        let mut world = VoxelWorld::new(IVec3::new(1, 2, 1));
        world.insert_chunk(Chunk::with_voxels(
            IVec3::ZERO,
            [VoxelType::Rock; CHUNK_VOLUME],
        ));
        world.insert_chunk(Chunk::new(IVec3::Y));
        world
            .get_chunk_mut(IVec3::Y)
            .unwrap()
            .set_lod_level(LodLevel::Lod3);

        let mesh_settings = MeshSettings {
            mode: MeshMode::SurfaceNets,
            ..Default::default()
        };
        let lod_settings = LodSettings::default();

        assert_eq!(
            world.get_chunk(IVec3::Y).unwrap().lod_level(),
            LodLevel::Lod3
        );
        assert_eq!(
            build_terrain_neighbor_lods(&world, IVec3::ZERO, &mesh_settings, &lod_settings).pos_y,
            Some(LodLevel::Lod0)
        );
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

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, true);

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

        let preparing = world_startup_snapshot(&gen_state, &chunk_stats, true);
        assert_eq!(preparing.stage, WorldStartupStage::PreparingMeshes);
        assert!(!preparing.complete);

        chunk_stats.mesh_entities = 1;
        let ready = world_startup_snapshot(&gen_state, &chunk_stats, true);
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

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, true);

        assert_eq!(snapshot.stage, WorldStartupStage::PreparingMeshes);
        assert!(snapshot.detail.contains("waiting for neighbors"));
        assert!(!snapshot.complete);
    }

    #[test]
    fn world_startup_snapshot_waits_for_overlay_before_generation() {
        let gen_state = ChunkGenerationState::default();
        let chunk_stats = RuntimeChunkStats::default();

        let snapshot = world_startup_snapshot(&gen_state, &chunk_stats, false);

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
            MAX_LOD_DIRTY_CHUNKS_PER_FRAME
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
    fn terrain_lod_uses_triplanar_material_for_far_meshes() {
        assert_eq!(
            terrain_material_quality_for_lod(LodLevel::Lod1, None),
            TerrainMaterialQuality::CheapTriplanar
        );
        assert_eq!(
            terrain_material_quality_for_distance(
                TERRAIN_MATERIAL_LOD_DISTANCE + TERRAIN_MATERIAL_LOD_HYSTERESIS + 1.0,
                TerrainMaterialQuality::FullTriplanar,
                None,
                RenderQualityPreset::High,
            ),
            TerrainMaterialQuality::CheapTriplanar
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
