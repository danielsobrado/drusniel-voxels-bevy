//! Voxel world plugin for chunk management and terrain generation.
//!
//! This module provides the core voxel functionality including:
//! - Procedural terrain generation with biomes, caves, dungeons, and trees
//! - Chunk-based world management with LOD (Level of Detail)
//! - Mesh generation and update systems

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    CHUNK_SIZE, CHUNK_SIZE_F32, CHUNK_SIZE_I32,
    // LOD
    DEFAULT_HIGH_DETAIL_DISTANCE, DEFAULT_CULL_DISTANCE,
    INTEGRATED_GPU_HIGH_DETAIL_DISTANCE, INTEGRATED_GPU_CULL_DISTANCE,
};
use crate::physics::NeedsCollider;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::materials::VoxelMaterial;
use crate::rendering::triplanar_material::TriplanarMaterialHandle;
use crate::rendering::AmbientOcclusionConfig;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::meshing::{generate_chunk_mesh_with_mode, MeshMode, MeshSettings};
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::terrain::TerrainGenerator;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

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
            low_detail_mode: MeshMode::Blocky,
        }
    }
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
        // World persistence settings (set force_regenerate to true to regenerate)
        .insert_resource(WorldPersistence {
            force_regenerate: false,
            ..default()
        })
        .add_systems(Startup, setup_voxel_world)
        .add_systems(
            Update,
            (
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

/// Generates a single chunk using the terrain generator.
fn generate_chunk(chunk_pos: IVec3, generator: &TerrainGenerator) -> (Chunk, ChunkStats) {
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

    if stats.wood > 0 || stats.leaves > 0 { debug!("Chunk {:?}: wood={}, leaves={}", chunk_pos, stats.wood, stats.leaves); }
    chunk.mark_dirty();
    (chunk, stats)
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
}

impl WorldStats {
    fn add(&mut self, chunk_stats: &ChunkStats) {
        self.total_sand += chunk_stats.sand;
        self.total_dungeon_wall += chunk_stats.dungeon_wall;
        self.total_dungeon_floor += chunk_stats.dungeon_floor;
        self.total_wood += chunk_stats.wood;
        self.total_leaves += chunk_stats.leaves;
    }

    fn log_summary(&self, generation_time: std::time::Duration) {
        info!("=== WORLD GENERATION SUMMARY ===");
        info!("Generation time: {:.2}s", generation_time.as_secs_f32());
        info!("Total sand blocks: {}", self.total_sand);
        info!("Total dungeon wall blocks: {}", self.total_dungeon_wall);
        info!("Total dungeon floor blocks: {}", self.total_dungeon_floor);
        info!("Total wood blocks: {}", self.total_wood);
        info!("Total leaves blocks: {}", self.total_leaves);
        info!("Dungeons at positions like (0-19, 3-18, 0-19), (96-115, 3-18, 96-115), etc.");
        info!("Sand appears near water (terrain height <= 24) and in sandy biomes");
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

/// Main world setup system.
fn setup_voxel_world(mut world: ResMut<VoxelWorld>, persistence_settings: Res<WorldPersistence>) {
    // Try to load existing world
    if try_load_world(&mut world, &persistence_settings) {
        return;
    }

    info!("Generating new world...");
    let start_time = std::time::Instant::now();

    let generator = TerrainGenerator::default();
    let chunk_positions: Vec<IVec3> = world.all_chunk_positions().collect();
    let mut stats = WorldStats::default();

    for chunk_pos in chunk_positions {
        let (chunk, chunk_stats) = generate_chunk(chunk_pos, &generator);

        // Log chunks with dungeon content
        if chunk_stats.dungeon_wall > 0 || chunk_stats.dungeon_floor > 0 {
            let chunk_world = IVec3::new(
                chunk_pos.x * CHUNK_SIZE_I32,
                chunk_pos.y * CHUNK_SIZE_I32,
                chunk_pos.z * CHUNK_SIZE_I32,
            );
            info!(
                "Chunk {:?} (world {:?}): {} dungeon walls, {} floors",
                chunk_pos, chunk_world, chunk_stats.dungeon_wall, chunk_stats.dungeon_floor
            );
        }

        stats.add(&chunk_stats);
        world.insert_chunk(chunk);
    }

    stats.log_summary(start_time.elapsed());
    try_save_world(&world, &persistence_settings);
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
    mut material_logged: Local<bool>,
) {
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

    for chunk_pos in dirty_chunks {
        let (target_mode, lod_level) = if let Some(chunk) = world.get_chunk(chunk_pos) {
            let target_mode = match chunk.lod_level() {
                LodLevel::High => mesh_settings.mode,
                LodLevel::Low => lod_settings.low_detail_mode,
                LodLevel::Culled => lod_settings.low_detail_mode,
            };

            (target_mode, chunk.lod_level())
        } else {
            continue;
        };

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
        }
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
