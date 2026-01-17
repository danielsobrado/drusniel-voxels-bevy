//! Voxel world plugin for chunk management and terrain generation.
//!
//! This module provides the core voxel functionality including:
//! - Procedural terrain generation with biomes, caves, dungeons, and trees
//! - Chunk-based world management with LOD (Level of Detail)
//! - Mesh generation and update systems
//! - Async chunk generation using Bevy's task pool

use std::sync::Arc;

use bevy::prelude::*;
use bevy::tasks::{block_on, poll_once, AsyncComputeTaskPool, Task};

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    BEDROCK_DEPTH, CHUNK_SIZE, CHUNK_SIZE_F32, CHUNK_SIZE_I32,
    // LOD
    DEFAULT_HIGH_DETAIL_DISTANCE, DEFAULT_CULL_DISTANCE,
    INTEGRATED_GPU_HIGH_DETAIL_DISTANCE, INTEGRATED_GPU_CULL_DISTANCE,
};
use crate::physics::NeedsCollider;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::materials::VoxelMaterial;
use crate::rendering::triplanar_material::TriplanarMaterialHandle;
use crate::rendering::AmbientOcclusionConfig;
use crate::voxel::chunk::{Chunk, ChunkUniformity, LodLevel};
use crate::voxel::meshing::{generate_chunk_mesh_with_mode, MeshMode, MeshSettings};
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::terrain::TerrainGenerator;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;

pub struct VoxelPlugin;

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

    // Per-frame statistics (reset each frame in the meshing system)
    pub chunks_meshed_this_frame: u32,
    pub chunks_skipped_this_frame: u32,

    // LOD statistics
    pub high_lod_chunks: u32,
    pub low_lod_chunks: u32,
    pub culled_chunks: u32,
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
                LodLevel::High => self.high_lod_chunks += 1,
                LodLevel::Low => self.low_lod_chunks += 1,
                LodLevel::Culled => self.culled_chunks += 1,
            }
        }
    }

    /// Reset per-frame counters.
    pub fn reset_frame_counters(&mut self) {
        self.chunks_meshed_this_frame = 0;
        self.chunks_skipped_this_frame = 0;
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
        app.insert_resource(WorldConfig {
            size_chunks: IVec3::new(32, 4, 32),
            chunk_size: 16,
            greedy_meshing: true,
        })
        .insert_resource(VoxelWorld::new(IVec3::new(32, 4, 32)))
        // Use SurfaceNets for smooth terrain meshing (change to Blocky for Minecraft-style)
        .insert_resource(MeshSettings {
            mode: MeshMode::SurfaceNets,
        })
        .insert_resource(LodSettings::default())
        .insert_resource(SkirtConfig::default())
        // Runtime chunk statistics for debug overlay
        .insert_resource(RuntimeChunkStats::default())
        // Async chunk generation state
        .insert_resource(ChunkGenerationState::default())
        // World persistence settings (set force_regenerate to true to regenerate)
        .insert_resource(WorldPersistence {
            force_regenerate: false,
            ..default()
        })
        .add_systems(Startup, setup_voxel_world)
        .add_systems(
            Update,
            (
                poll_chunk_generation_tasks,
                adjust_lod_for_integrated_gpu,
                update_chunk_lod_system,
                mesh_dirty_chunks_system,
            )
                .chain(),
        );
        // .add_plugins(GravityPlugin); // Deactivated due to performance impact
    }
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
    if persistence_settings.force_regenerate {
        return false;
    }

    if !persistence::saved_world_exists() {
        return false;
    }

    info!("Loading saved world from disk...");
    match persistence::load_world() {
        Ok(loaded_world) => {
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

    info!(
        "Spawned {} async chunk generation tasks",
        total_chunks
    );
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

    chunk.mark_dirty();
    // Compute uniformity eagerly to enable skipping empty/solid chunks during meshing
    chunk.compute_uniformity();
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
        let prev_progress_pct =
            ((gen_state.chunks_completed - completed_count) as f32 / gen_state.total_chunks as f32 * 100.0) as u32;

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

fn mesh_dirty_chunks_system(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut meshes: ResMut<Assets<Mesh>>,
    blocky_material: Option<Res<VoxelMaterial>>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    water_material: Res<crate::rendering::materials::WaterMaterial>,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    skirt_config: Res<SkirtConfig>,
    ao_config: Res<AmbientOcclusionConfig>,
    mut chunk_stats: ResMut<RuntimeChunkStats>,
    mut material_logged: Local<bool>,
) {
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

    // Collect dirty chunks first to avoid borrowing issues
    let dirty_chunks: Vec<IVec3> = world.dirty_chunks().collect();
    let had_dirty_chunks = !dirty_chunks.is_empty();
    let mut chunks_meshed = 0u32;
    let mut chunks_skipped = 0u32;

    for chunk_pos in dirty_chunks {
        // Compute uniformity if unknown (lazy evaluation)
        if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
            if chunk.uniformity() == ChunkUniformity::Unknown {
                chunk.compute_uniformity();
            }
        }

        let (target_mode, lod_level, uniformity) = if let Some(chunk) = world.get_chunk(chunk_pos) {
            let target_mode = match chunk.lod_level() {
                LodLevel::High => mesh_settings.mode,
                LodLevel::Low => lod_settings.low_detail_mode,
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
                chunk.clear_dirty();
            }
            chunks_skipped += 1;
            continue;
        }

        // Skip meshing for empty chunks (all air) - no geometry to render
        if uniformity == ChunkUniformity::Empty {
            if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
                if let Some(entity) = chunk.mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_mesh_entity();
                }
                if let Some(entity) = chunk.water_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mesh_entity();
                }
                chunk.clear_dirty();
            }
            chunks_skipped += 1;
            continue;
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

        // Step 1: Generate mesh data using immutable borrow
        let mesh_result = if let Some(chunk) = world.get_chunk(chunk_pos) {
            generate_chunk_mesh_with_mode(
                chunk,
                &world,
                target_mode,
                lod_level,
                neighbor_lods,
                &skirt_config,
                &ao_config.baked,
            )
        } else {
            continue;
        };

        // Step 2: Update chunk state using mutable borrow
        if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
            // Clear dirty flag
            chunk.clear_dirty();

            let world_pos = VoxelWorld::chunk_to_world(chunk_pos);

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
                    commands
                        .entity(entity)
                        .insert((Mesh3d(mesh_handle), NeedsCollider));
                } else {
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
                                    crate::voxel::meshing::ChunkMesh {
                                        chunk_position: chunk_pos,
                                    },
                                    NeedsCollider,
                                ))
                                .id()
                        }
                        MeshMode::SurfaceNets => commands
                            .spawn((
                                Mesh3d(mesh_handle),
                                MeshMaterial3d(triplanar_material.handle.clone()),
                                Transform::from_xyz(
                                    world_pos.x as f32,
                                    world_pos.y as f32,
                                    world_pos.z as f32,
                                ),
                                crate::voxel::meshing::ChunkMesh {
                                    chunk_position: chunk_pos,
                                },
                                NeedsCollider,
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
            } else {
                let water_mesh = mesh_result.water.into_mesh();
                let water_mesh_handle = meshes.add(water_mesh);

                if let Some(entity) = chunk.water_mesh_entity() {
                    commands.entity(entity).insert(Mesh3d(water_mesh_handle));
                } else {
                    let entity = commands
                        .spawn((
                            Mesh3d(water_mesh_handle),
                            MeshMaterial3d(water_material.handle.clone()),
                            Transform::from_xyz(
                                world_pos.x as f32,
                                world_pos.y as f32,
                                world_pos.z as f32,
                            ),
                            crate::voxel::meshing::ChunkMesh {
                                chunk_position: chunk_pos,
                            },
                        ))
                        .id();
                    chunk.set_water_mesh_entity(entity);
                }
            }

            chunks_meshed += 1;
        }
    }

    // Update runtime statistics
    chunk_stats.chunks_meshed_this_frame = chunks_meshed;
    chunk_stats.chunks_skipped_this_frame = chunks_skipped;

    // Recompute full stats from world (only if there were dirty chunks to process)
    if had_dirty_chunks {
        chunk_stats.recompute_from_world(&world);
    }
}

/// Adjusts LOD settings for integrated GPUs to maintain performance.
///
/// This system runs once at startup and reduces view distances when an
/// integrated GPU is detected.
fn adjust_lod_for_integrated_gpu(
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut lod_settings: ResMut<LodSettings>,
    mut mesh_settings: ResMut<MeshSettings>,
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
        mesh_settings.mode = MeshMode::Blocky;
        info!("Integrated GPU detected; using more aggressive chunk LOD distances.");
    }

    *applied = true;
}

/// Updates the LOD level of each chunk based on distance from the camera.
///
/// Chunks are assigned to one of three LOD levels:
/// - `High`: Close to camera, uses full detail meshing
/// - `Low`: Medium distance, uses simplified meshing
/// - `Culled`: Far away, not rendered at all
fn update_chunk_lod_system(
    mut world: ResMut<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    lod_settings: Res<LodSettings>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let camera_pos = camera_transform.translation;

    let mut lod_changed: Vec<IVec3> = Vec::new();

    for (chunk_pos, chunk) in world.chunk_entries_mut() {
        let world_pos = VoxelWorld::chunk_to_world(*chunk_pos);
        let chunk_center = world_pos.as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let distance = chunk_center.distance(camera_pos);

        let target_lod = if distance <= lod_settings.high_detail_distance {
            LodLevel::High
        } else if distance <= lod_settings.cull_distance {
            LodLevel::Low
        } else {
            LodLevel::Culled
        };

        if chunk.set_lod_level(target_lod) {
            lod_changed.push(*chunk_pos);
        }
    }

    for chunk_pos in lod_changed {
        for offset in [
            IVec3::new(-1, 0, 0),
            IVec3::new(1, 0, 0),
            IVec3::new(0, 0, -1),
            IVec3::new(0, 0, 1),
        ] {
            let neighbor_pos = chunk_pos + offset;
            if let Some(neighbor) = world.get_chunk_mut(neighbor_pos) {
                neighbor.mark_dirty();
            }
        }
    }
}
