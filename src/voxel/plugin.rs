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
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponentPlugin;
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};

use crate::bench::BenchRenderToggles;
use crate::camera::controller::PlayerCamera;
use crate::constants::{
    BEDROCK_DEPTH,
    CHUNK_SIZE,
    CHUNK_SIZE_F32,
    CHUNK_SIZE_I32,
    DEFAULT_CULL_DISTANCE,
    // LOD
    DEFAULT_HIGH_DETAIL_DISTANCE,
    DEFAULT_WORLD_CHUNKS_X,
    DEFAULT_WORLD_CHUNKS_Y,
    DEFAULT_WORLD_CHUNKS_Z,
    INTEGRATED_GPU_CULL_DISTANCE,
    INTEGRATED_GPU_HIGH_DETAIL_DISTANCE,
    LOD_HYSTERESIS,
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
const MAX_DIRTY_CHUNKS_VISITED_PER_FRAME: usize = 64;
const MAX_LOD_DIRTY_CHUNKS_PER_FRAME: usize = 1;
const MAX_LOD_CHANGES_PER_UPDATE: usize = 4;
const LOD_CHANGE_COOLDOWN_FRAMES: u32 = 30;
const TERRAIN_LOD_HYSTERESIS: f32 = LOD_HYSTERESIS * 2.0;
const TERRAIN_MATERIAL_LOD_DISTANCE: f32 = 96.0;
const TERRAIN_MATERIAL_LOD_HYSTERESIS: f32 = 16.0;
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
use crate::constants::WATER_LEVEL;
use crate::physics::NeedsCollider;
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
    EnclosureOcclusionStats, EnclosureState, sync_occlusion_config_from_enclosure,
    toggle_enclosure_culling, update_enclosure_state,
};
use crate::voxel::hole_probe::TerrainHoleProbePlugin;
use crate::voxel::meshing::{
    ChunkMesh, MeshMode, MeshSettings, WaterBodyId, WaterBodyKind, WaterBodyMaterialMode,
    WaterMesh, WaterMeshDetail, count_missing_in_bounds_boundary_neighbors,
    empty_chunk_has_surface_nets_boundary_surface, generate_chunk_mesh_with_mode,
};
use crate::voxel::occlusion::{
    OcclusionConfig, OcclusionUpdateTimer, VisibleChunks, update_visible_chunks_system,
};
use crate::voxel::octree::ChunkOctree;
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::terrain::TerrainGenerator;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::visibility::compute_face_visibility;
use crate::voxel::world::{VoxelSample, VoxelWorld, WorldBounds};
use bevy::camera::visibility::RenderLayers;
use bevy_water::water::material::StandardWaterMaterial;

fn env_flag(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

pub struct VoxelPlugin;

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

/// Component to hold a pending chunk generation task.
#[derive(Component)]
struct ChunkGenerationTask {
    task: Task<ChunkGenerationResult>,
    chunk_pos: IVec3,
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
        .insert_resource(TerrainLodControl::default())
        .insert_resource(TerrainLodTransitionState::default())
        .insert_resource(SkirtConfig::default())
        // Runtime chunk statistics for debug overlay
        .insert_resource(RuntimeChunkStats::default())
        .insert_resource(WaterBodyRegistry::default())
        // Async chunk generation state
        .insert_resource(ChunkGenerationState::default())
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
        .add_systems(Startup, setup_voxel_world)
        .add_systems(
            Update,
            (
                // Stage 1: Pull newly-generated chunks into VoxelWorld
                poll_chunk_generation_tasks,
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
                // Stage 5: Meshing (needs LOD from stage 4)
                mesh_dirty_chunks_system.after(update_chunk_lod_system),
                // Stage 5b: Water material LOD (independent of meshing, can be parallel)
                update_water_body_registry.after(mesh_dirty_chunks_system),
                update_water_material_lod.after(update_water_body_registry),
                draw_water_body_debug_overlay.after(update_water_body_registry),
                update_terrain_material_lod.after(update_chunk_lod_system),
                record_voxel_edit_counters,
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

/// Attempts to load an existing world from disk.
///
/// Returns `true` if loading succeeded, `false` otherwise.
fn try_load_world(world: &mut VoxelWorld, persistence_settings: &WorldPersistence) -> bool {
    if env_flag("VOXEL_REGENERATE_WATER_BODIES")
        || env_flag("VOXEL_FORCE_REGENERATE_WORLD")
        || env_flag("VOXEL_FORCE_REGENERATE_WATER")
    {
        match persistence::delete_saved_world() {
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

    if !persistence::saved_world_exists() {
        return false;
    }

    if env_flag("DRUSNIEL_EDITOR_NATIVE_VIEWPORT") {
        info!("Loading saved world for native editor viewport...");
        match persistence::read_world_data_from_path(persistence::WORLD_SAVE_PATH) {
            Ok(data) => {
                let loaded_world = VoxelWorld::from_data(data);
                if loaded_world.world_size_chunks() != world.world_size_chunks() {
                    warn!(
                        "Saved world size {:?} does not match configured world size {:?}; regenerating",
                        loaded_world.world_size_chunks(),
                        world.world_size_chunks()
                    );
                    return false;
                }
                *world = loaded_world;
                info!("World loaded successfully for native editor viewport!");
                return true;
            }
            Err(e) => {
                warn!(
                    "Failed to load saved world for native editor viewport: {}. Generating new world...",
                    e
                );
                return false;
            }
        }
    }

    info!("Loading saved world from disk...");
    match persistence::load_world() {
        Ok(loaded_world) => {
            if loaded_world.world_size_chunks() != world.world_size_chunks() {
                warn!(
                    "Saved world size {:?} does not match configured world size {:?}; regenerating",
                    loaded_world.world_size_chunks(),
                    world.world_size_chunks()
                );
                return false;
            }
            *world = loaded_world;
            info!("World loaded successfully!");
            true
        }
        Err(e) => {
            warn!("Failed to load saved world: {}. Generating new world...", e);
            false
        }
    }
}

fn enforce_bedrock_floor(world: &mut VoxelWorld) -> bool {
    let mut changed = false;

    for (chunk_pos, chunk) in world.chunk_entries_mut() {
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
            chunk.mark_dirty();
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
    match persistence::save_world(world) {
        Ok(()) => info!("World saved successfully!"),
        Err(e) => warn!("Failed to save world: {}", e),
    }
}

/// Main world setup system - spawns async chunk generation tasks.
fn setup_voxel_world(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    persistence_settings: Res<WorldPersistence>,
) {
    // Try to load existing world from disk (synchronous, fast)
    if try_load_world(&mut world, &persistence_settings) {
        gen_state.loading_from_disk = true;
        gen_state.is_complete = true;
        if enforce_bedrock_floor(&mut world) {
            info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
            try_save_world(&world, &persistence_settings);
        }
        return;
    }

    // Spawn async chunk generation tasks
    info!("Generating new world (async)...");

    let chunk_positions: Vec<IVec3> = world.all_chunk_positions().collect();
    let total_chunks = chunk_positions.len() as u32;

    gen_state.total_chunks = total_chunks;
    gen_state.chunks_completed = 0;
    gen_state.is_complete = false;
    gen_state.loading_from_disk = false;
    gen_state.world_stats = WorldStats::default();
    gen_state.start_time = Some(std::time::Instant::now());

    // Create a shared terrain generator (Arc for thread safety)
    let generator = Arc::new(TerrainGenerator::default());

    // Get the async compute task pool
    let task_pool = AsyncComputeTaskPool::get();

    // Spawn a task for each chunk
    for chunk_pos in chunk_positions {
        let generator = Arc::clone(&generator);

        let task = task_pool.spawn(async move {
            let (chunk, stats) = generate_chunk_async(chunk_pos, &generator);
            ChunkGenerationResult { chunk, stats }
        });

        commands.spawn(ChunkGenerationTask { task, chunk_pos });
    }

    info!("Spawned {} async chunk generation tasks", total_chunks);
}

/// Generates a single chunk using the terrain generator (for async execution).
fn generate_chunk_async(chunk_pos: IVec3, generator: &TerrainGenerator) -> (Chunk, ChunkStats) {
    let mut chunk = Chunk::new(chunk_pos);
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
    let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;

    let mut stats = ChunkStats::default();

    for x in 0..CHUNK_SIZE {
        for z in 0..CHUNK_SIZE {
            let world_x = chunk_world_x + x as i32;
            let world_z = chunk_world_z + z as i32;

            for y in 0..CHUNK_SIZE {
                let world_y = chunk_world_y + y as i32;

                let voxel = if DEBUG_FLAT_WORLD {
                    if world_y <= 12 {
                        VoxelType::TopSoil
                    } else {
                        VoxelType::Air
                    }
                } else {
                    generator.get_voxel(world_x, world_y, world_z)
                };

                // Track statistics
                match voxel {
                    VoxelType::Sand => stats.sand += 1,
                    VoxelType::DungeonWall => stats.dungeon_wall += 1,
                    VoxelType::DungeonFloor => stats.dungeon_floor += 1,
                    VoxelType::Wood => stats.wood += 1,
                    VoxelType::Leaves => stats.leaves += 1,
                    _ => {}
                }

                chunk.set(UVec3::new(x as u32, y as u32, z as u32), voxel);
            }
        }
    }

    // Compute uniformity eagerly to enable skipping empty/solid chunks during meshing
    chunk.compute_uniformity();
    chunk.clear_dirty();
    chunk.mark_dirty_with_reason(MeshDirtyReason::Generation);
    (chunk, stats)
}

/// Polls completed chunk generation tasks and inserts chunks into the world.
fn poll_chunk_generation_tasks(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut tasks: Query<(Entity, &mut ChunkGenerationTask)>,
    persistence_settings: Res<WorldPersistence>,
) {
    // Skip if generation is already complete
    if gen_state.is_complete {
        return;
    }

    // Poll all pending tasks
    let mut completed_count = 0u32;

    for (entity, mut task) in tasks.iter_mut() {
        if let Some(result) = block_on(poll_once(&mut task.task)) {
            // Task completed - insert chunk into world
            let chunk_pos = task.chunk_pos;
            let uniformity = result.chunk.uniformity();

            // Log chunks with dungeon content
            if result.stats.dungeon_wall > 0 || result.stats.dungeon_floor > 0 {
                let chunk_world = IVec3::new(
                    chunk_pos.x * CHUNK_SIZE_I32,
                    chunk_pos.y * CHUNK_SIZE_I32,
                    chunk_pos.z * CHUNK_SIZE_I32,
                );
                debug!(
                    "Chunk {:?} (world {:?}): {} dungeon walls, {} floors",
                    chunk_pos, chunk_world, result.stats.dungeon_wall, result.stats.dungeon_floor
                );
            }

            // Update stats
            gen_state.world_stats.add(&result.stats, uniformity);

            // Insert chunk into world
            world.insert_chunk(result.chunk);

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

#[derive(Default)]
struct MeshDirtyReasonCounts {
    lod: u32,
    neighbor_lod: u32,
    visibility: u32,
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
        if flags & MeshDirtyReason::Visibility.bit() != 0 {
            self.visibility += 1;
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

fn mesh_dirty_chunks_system(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut meshes: ResMut<Assets<Mesh>>,
    blocky_material: Option<Res<VoxelMaterial>>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    water_material: Res<WaterMaterial>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    skirt_config: Res<SkirtConfig>,
    ao_config: Res<AmbientOcclusionConfig>,
    mut chunk_stats: ResMut<RuntimeChunkStats>,
    mut material_logged: Local<bool>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let mesh_dirty_total_start = timing.enabled.then(Instant::now);
    // Reset per-frame counters
    chunk_stats.reset_frame_counters();

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
    // Sort by distance to camera if available
    if let Some(camera_pos) = camera_pos {
        dirty_chunks.sort_by(|a, b| {
            let world_a =
                VoxelWorld::chunk_to_world(*a).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
            let world_b =
                VoxelWorld::chunk_to_world(*b).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
            let dist_a = world_a.distance_squared(camera_pos);
            let dist_b = world_b.distance_squared(camera_pos);
            dist_a
                .partial_cmp(&dist_b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }
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
            || reason_counts.visibility > 0
            || reason_counts.water_material > 0);
    let chunks_per_frame_limit = if lod_churn_only {
        MAX_LOD_DIRTY_CHUNKS_PER_FRAME
    } else {
        MAX_CHUNKS_PER_FRAME
    };
    let mut terrain_mesh_empty_but_solid_voxels = 0u32;
    let mut terrain_mesh_boundary_missing_neighbor = 0u32;
    let terrain_mesh_degenerate_triangles_removed = 0u32;
    let mut terrain_mesh_lod_seam_repairs = 0u32;

    for chunk_pos in dirty_chunks {
        // Throttle expensive mesh generation, but let cheap empty/culled clears
        // drain faster so dirty queues do not stay backed up for hundreds of frames.
        if chunks_processed >= MAX_DIRTY_CHUNKS_VISITED_PER_FRAME
            || chunks_meshed as usize >= chunks_per_frame_limit
        {
            break;
        }
        chunks_processed += 1;
        // Compute uniformity if unknown (lazy evaluation)
        if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
            if chunk.uniformity() == ChunkUniformity::Unknown {
                chunk.compute_uniformity();
            }
        }

        let (target_mode, lod_level, uniformity) = if let Some(chunk) = world.get_chunk(chunk_pos) {
            let target_mode = match chunk.lod_level() {
                LodLevel::Lod0 => mesh_settings.mode,
                LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 => lod_settings.low_detail_mode,
                LodLevel::Culled => lod_settings.low_detail_mode,
            };

            (target_mode, chunk.lod_level(), chunk.uniformity())
        } else {
            continue;
        };

        // Skip meshing for culled chunks
        if lod_level == LodLevel::Culled {
            if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
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
            && matches!(target_mode, MeshMode::SurfaceNets)
            && empty_chunk_has_surface_nets_boundary_surface(&world, chunk_pos);

        // Skip meshing for empty chunks unless Surface Nets needs this all-air
        // chunk to own a terrain boundary surface from the one-voxel halo.
        if uniformity == ChunkUniformity::Empty {
            if empty_surface_neighbor {
                terrain_mesh_lod_seam_repairs += 1;
            } else {
                if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
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
        }

        let neighbor_lods = NeighborLods {
            neg_x: world
                .get_chunk(chunk_pos + IVec3::new(-1, 0, 0))
                .map(|c| c.lod_level()),
            pos_x: world
                .get_chunk(chunk_pos + IVec3::new(1, 0, 0))
                .map(|c| c.lod_level()),
            neg_z: world
                .get_chunk(chunk_pos + IVec3::new(0, 0, -1))
                .map(|c| c.lod_level()),
            pos_z: world
                .get_chunk(chunk_pos + IVec3::new(0, 0, 1))
                .map(|c| c.lod_level()),
        };

        // Step 1: Generate mesh data using immutable borrow (with timing)
        let mesh_start = Instant::now();
        let mesh_result = if let Some(chunk) = world.get_chunk(chunk_pos) {
            generate_chunk_mesh_with_mode(
                chunk,
                &world,
                target_mode,
                lod_level,
                neighbor_lods,
                &skirt_config,
                &ao_config.baked,
                mesh_settings.water_air_exposure_mode,
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

        let water_depth_detail = if mesh_result.water.is_empty() {
            WaterChunkDepthDetail::default()
        } else {
            compute_water_chunk_depth_detail(&world, chunk_pos)
        };

        // Step 2: Update chunk state using mutable borrow
        let apply_start = timing.enabled.then(Instant::now);
        if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
            // Clear dirty flag
            chunk.clear_dirty();

            let world_pos = VoxelWorld::chunk_to_world(chunk_pos);
            let terrain_quality =
                terrain_material_quality_for_lod(lod_level, bench_toggles.as_deref());
            let triplanar_handle = triplanar_material.handle_for_quality(terrain_quality);
            let chunk_mesh = crate::voxel::meshing::ChunkMesh {
                chunk_position: chunk_pos,
                vertex_count,
                triangle_count,
                mesh_mode: target_mode,
                material_quality: terrain_quality,
            };

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
                    match mesh_settings.mode {
                        MeshMode::Blocky => {
                            if let Some(blocky_mat) = blocky_material.as_ref() {
                                commands
                                    .entity(entity)
                                    .insert((
                                        Mesh3d(mesh_handle),
                                        MeshMaterial3d(blocky_mat.handle.clone()),
                                        chunk_mesh,
                                        NeedsCollider,
                                    ))
                                    .remove::<MeshMaterial3d<
                                        crate::rendering::triplanar_material::TriplanarMaterial,
                                    >>();
                            }
                        }
                        MeshMode::SurfaceNets => {
                            commands
                                .entity(entity)
                                .insert((
                                    Mesh3d(mesh_handle),
                                    MeshMaterial3d(triplanar_handle),
                                    chunk_mesh,
                                    NeedsCollider,
                                ))
                                .remove::<MeshMaterial3d<crate::rendering::blocky_material::BlockyMaterial>>();
                        }
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
                    let entity = match mesh_settings.mode {
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
                                    NeedsCollider,
                                    terrain_layers,
                                ))
                                .id()
                        }
                        MeshMode::SurfaceNets => commands
                            .spawn((
                                Mesh3d(mesh_handle),
                                MeshMaterial3d(triplanar_handle),
                                Transform::from_xyz(
                                    world_pos.x as f32,
                                    world_pos.y as f32,
                                    world_pos.z as f32,
                                ),
                                chunk_mesh,
                                NeedsCollider,
                                terrain_layers,
                            ))
                            .id(),
                    };
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

    // Keep the O(N) debug/stat snapshot off hot dirty-mesh frames while the
    // terrain queue is backed up. Per-frame mesh counters above stay current.
    let stats_recompute_due = had_dirty_chunks && frame.0 % 30 == 0;
    let stats_recompute_blocked =
        stats_recompute_due && dirty_chunks_queued > chunks_per_frame_limit;
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
        MAX_DIRTY_CHUNKS_VISITED_PER_FRAME as f64,
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
        "Mesh Dirty Reason Visibility",
        reason_counts.visibility as f64,
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
        "Terrain Mesh Degenerate Triangles Removed",
        terrain_mesh_degenerate_triangles_removed as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh LOD Seam Repairs",
        terrain_mesh_lod_seam_repairs as f64,
    );
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
            TerrainMaterialQuality::SingleProjectionFar
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
            TerrainMaterialQuality::SingleProjectionFar
        }
        TerrainMaterialQuality::SingleProjectionFar if distance < switch_in => {
            TerrainMaterialQuality::FullTriplanar
        }
        TerrainMaterialQuality::CheapTriplanar | TerrainMaterialQuality::AtlasOnlyDebug => current,
        _ => current,
    }
}

fn update_terrain_material_lod(
    time: Res<Time>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    quality_preset: Res<RenderQualityPreset>,
    mut terrain_meshes: Query<
        (
            &Transform,
            &mut ChunkMesh,
            &mut MeshMaterial3d<TriplanarMaterial>,
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

    for (transform, mut chunk_mesh, mut material) in &mut terrain_meshes {
        if chunk_mesh.mesh_mode != MeshMode::SurfaceNets {
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
    edge_north: HashSet<i32>,
    edge_south: HashSet<i32>,
    edge_west: HashSet<i32>,
    edge_east: HashSet<i32>,
}

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
            edge_north: HashSet::default(),
            edge_south: HashSet::default(),
            edge_west: HashSet::default(),
            edge_east: HashSet::default(),
        });
    }

    let surface_y = y_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(y, _)| y)
        .unwrap_or(WATER_LEVEL);

    let mut edge_north = HashSet::new();
    let mut edge_south = HashSet::new();
    let mut edge_west = HashSet::new();
    let mut edge_east = HashSet::new();
    for (x, z, y, _) in &surface_cells {
        if *y != surface_y {
            continue;
        }
        if *z == 0 {
            edge_north.insert(*x);
        }
        if *z == CHUNK_SIZE_I32 - 1 {
            edge_south.insert(*x);
        }
        if *x == 0 {
            edge_west.insert(*z);
        }
        if *x == CHUNK_SIZE_I32 - 1 {
            edge_east.insert(*z);
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
            for neighbor in water_body_neighbors(index, samples, &index_by_chunk) {
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
) -> Vec<usize> {
    let sample = &samples[index];
    let candidates = [
        (
            sample.chunk_pos + IVec3::X,
            &sample.edge_east,
            WaterBodyEdge::West,
        ),
        (
            sample.chunk_pos + IVec3::NEG_X,
            &sample.edge_west,
            WaterBodyEdge::East,
        ),
        (
            sample.chunk_pos + IVec3::Z,
            &sample.edge_south,
            WaterBodyEdge::North,
        ),
        (
            sample.chunk_pos + IVec3::NEG_Z,
            &sample.edge_north,
            WaterBodyEdge::South,
        ),
    ];

    candidates
        .into_iter()
        .filter_map(|(chunk_pos, edge, neighbor_edge)| {
            let neighbor_index = *index_by_chunk.get(&chunk_pos)?;
            let neighbor = &samples[neighbor_index];
            if sample.surface_y != neighbor.surface_y {
                return None;
            }
            let other_edge = match neighbor_edge {
                WaterBodyEdge::North => &neighbor.edge_north,
                WaterBodyEdge::South => &neighbor.edge_south,
                WaterBodyEdge::West => &neighbor.edge_west,
                WaterBodyEdge::East => &neighbor.edge_east,
            };
            edge.iter()
                .any(|value| other_edge.contains(value))
                .then_some(neighbor_index)
        })
        .collect()
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
    let nearest_distance = camera_pos
        .map(|pos| distance_to_aabb_xz(pos, aabb_min, aabb_max))
        .unwrap_or(f32::INFINITY);
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
        WaterBodyKind::ShallowFlood => 0.12,
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
    kind: WaterBodyKind,
) -> WaterBodyMaterialMode {
    if env_flag("VOXEL_FORCE_ALL_WATER_CHEAP") {
        return WaterBodyMaterialMode::Cheap;
    }
    if env_flag("VOXEL_FORCE_ALL_WATER_FANCY") {
        return WaterBodyMaterialMode::Fancy;
    }
    if kind == WaterBodyKind::ShallowFlood {
        return WaterBodyMaterialMode::Cheap;
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

    for (entity, transform, fancy_mat, cheap_mat, detail, body_id) in water_meshes.iter() {
        let fallback_kind = body_id
            .and_then(|id| registry.bodies.get(id).map(|body| body.kind))
            .unwrap_or(WaterBodyKind::Unknown);
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
        if let Some((body_mode, body_kind)) = body_id.and_then(|id| {
            registry
                .bodies
                .get(id)
                .map(|body| (body.material_mode, body.kind))
        }) {
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
                WaterBodyMaterialMode::Hidden => {
                    commands.entity(entity).insert(Visibility::Hidden);
                }
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
        lod_settings.low_detail_mode = MeshMode::Blocky;
        // Keep mesh_settings.mode as SurfaceNets for nearby chunks (V0.3 triplanar PBR look)
        // Only distant LOD chunks use Blocky mode for performance
        info!(
            "Integrated GPU detected; using more aggressive LOD distances, keeping SurfaceNets for nearby terrain."
        );
    }

    *applied = true;
}

/// Calculates the target LOD level with hysteresis to prevent rapid switching.
///
/// Hysteresis means the threshold to switch FROM a level is different than TO it:
/// - To switch from Lod0 → Lod1: must exceed high_detail_distance + hysteresis
/// - To switch from Lod1 → Lod0: must be within high_detail_distance - hysteresis
/// This prevents flip-flopping when camera hovers near a threshold.
fn calculate_target_lod_with_hysteresis(
    distance: f32,
    current_lod: LodLevel,
    settings: &LodSettings,
) -> LodLevel {
    // Distance thresholds for LOD transitions
    // Lod0: 0 to high_detail_distance
    // Lod1: high_detail_distance to lod1_distance (midpoint to cull)
    // Lod2+: lod1_distance to cull_distance
    let lod1_distance = (settings.high_detail_distance + settings.cull_distance) * 0.5;
    // Fix: Ensure lod2_distance is between lod1 and cull (midpoint of the remaining range)
    let lod2_distance = lod1_distance + (settings.cull_distance - lod1_distance) * 0.5;

    match current_lod {
        LodLevel::Lod0 => {
            // Currently highest detail - need to go PAST threshold to switch to lower
            if distance > settings.high_detail_distance + TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod1
            } else {
                LodLevel::Lod0
            }
        }
        LodLevel::Lod1 => {
            // Check transitions in both directions
            if distance < settings.high_detail_distance - TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod0
            } else if distance > lod1_distance + TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod2
            } else {
                LodLevel::Lod1
            }
        }
        LodLevel::Lod2 => {
            if distance < lod1_distance - TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod1
            } else if distance > lod2_distance + TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod3
            } else {
                LodLevel::Lod2
            }
        }
        LodLevel::Lod3 => {
            if distance < lod2_distance - TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod2
            } else if distance > settings.cull_distance + TERRAIN_LOD_HYSTERESIS {
                LodLevel::Culled
            } else {
                LodLevel::Lod3
            }
        }
        LodLevel::Culled => {
            // Currently culled - need to come INSIDE cull threshold to show
            if distance < settings.cull_distance - TERRAIN_LOD_HYSTERESIS {
                LodLevel::Lod3
            } else {
                LodLevel::Culled
            }
        }
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
        if let Some(chunk) = world.get_chunk_mut(pos) {
            // Ensure uniformity is computed first (needed by visibility algorithm)
            chunk.compute_uniformity();
            let visibility = compute_face_visibility(chunk);
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
/// Throttled to every 0.25s and skipped when camera hasn't moved significantly.
fn update_chunk_lod_system(
    mut world: ResMut<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    lod_settings: Res<LodSettings>,
    lod_control: Res<TerrainLodControl>,
    mut lod_transitions: ResMut<TerrainLodTransitionState>,
    time: Res<Time>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut last_update: Local<f32>,
    mut last_camera_pos: Local<Option<Vec3>>,
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

    // Skip if camera hasn't moved more than 2 world units since last update
    if let Some(prev) = *last_camera_pos {
        if camera_pos.distance_squared(prev) < 4.0 {
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
    }

    *last_update = now;
    *last_camera_pos = Some(camera_pos);

    let mut lod_candidates: Vec<(IVec3, LodLevel, LodLevel, f32)> = Vec::new();

    for (chunk_pos, chunk) in world.chunk_entries_mut() {
        let world_pos = VoxelWorld::chunk_to_world(*chunk_pos);
        let chunk_center = world_pos.as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let distance = chunk_center.distance(camera_pos);

        // Use hysteresis-aware LOD calculation
        let current_lod = chunk.lod_level();
        let target_lod = calculate_target_lod_with_hysteresis(distance, current_lod, &lod_settings);

        if target_lod != current_lod {
            let cooldown_elapsed = lod_transitions
                .last_change_frame
                .get(chunk_pos)
                .map(|last_frame| frame.0.saturating_sub(*last_frame) >= LOD_CHANGE_COOLDOWN_FRAMES)
                .unwrap_or(true);
            if !cooldown_elapsed {
                continue;
            }
            lod_candidates.push((*chunk_pos, current_lod, target_lod, distance));
        }
    }

    lod_candidates.sort_by(|a, b| {
        let a_upgrade = a.2.is_higher_detail_than(a.1);
        let b_upgrade = b.2.is_higher_detail_than(b.1);
        b_upgrade
            .cmp(&a_upgrade)
            .then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut lod_changed: Vec<IVec3> = Vec::new();
    for (chunk_pos, _current_lod, target_lod, _distance) in
        lod_candidates.into_iter().take(MAX_LOD_CHANGES_PER_UPDATE)
    {
        let Some(chunk) = world.get_chunk_mut(chunk_pos) else {
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
    for chunk_pos in &lod_changed {
        for offset in [
            IVec3::new(-1, 0, 0),
            IVec3::new(1, 0, 0),
            IVec3::new(0, 0, -1),
            IVec3::new(0, 0, 1),
        ] {
            let neighbor_pos = *chunk_pos + offset;
            if let Some(neighbor) = world.get_chunk_mut(neighbor_pos) {
                neighbor.mark_dirty_with_reason(MeshDirtyReason::NeighborLod);
            }
        }
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
    record_lod_counters(
        &mut timing,
        frame.0,
        lod_changed_count,
        changes_per_second,
        repeated_chunks_this_frame,
    );
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
