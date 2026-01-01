//! Voxel world plugin for chunk management and terrain generation.
//!
//! This module provides the core voxel functionality including:
//! - Procedural terrain generation with biomes, caves, dungeons, and trees
//! - Chunk-based world management with LOD (Level of Detail)
//! - Mesh generation and update systems

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    CHUNK_SIZE, CHUNK_SIZE_F32, CHUNK_SIZE_I32,
    // Terrain generation
    TERRAIN_BASE_FREQUENCY, TERRAIN_HILL_FREQUENCY, TERRAIN_MOUNTAIN_FREQUENCY,
    TERRAIN_RIVER_FREQUENCY, TERRAIN_BIOME_FREQUENCY, TERRAIN_CAVE_FREQUENCY,
    TERRAIN_BASE_HEIGHT, TERRAIN_BASE_AMPLITUDE, TERRAIN_HILL_AMPLITUDE,
    TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT,
    MOUNTAIN_THRESHOLD, MOUNTAIN_MULTIPLIER, RIVER_WIDTH_THRESHOLD, RIVER_CARVE_DEPTH,
    WATER_LEVEL, BEACH_HEIGHT_OFFSET,
    // Biomes
    BIOME_SANDY_THRESHOLD, BIOME_ROCKY_THRESHOLD, BIOME_ROCKY_DETAIL_THRESHOLD,
    BIOME_CLAY_MIN, BIOME_CLAY_MAX, BIOME_CLAY_DETAIL_THRESHOLD,
    // Trees
    TREE_SPAWN_THRESHOLD, TREE_MIN_HEIGHT, TREE_HEIGHT_VARIANCE, TREE_LEAF_CHECK_RADIUS, TREE_LEAF_RADIUS,
    // Dungeons
    DUNGEON_SPACING, DUNGEON_SIZE, DUNGEON_FLOOR_Y, DUNGEON_HEIGHT,
    DUNGEON_ENTRANCE_SIZE, DUNGEON_ENTRANCE_MAX_Y, DUNGEON_WALL_SPACING,
    // LOD
    DEFAULT_HIGH_DETAIL_DISTANCE, DEFAULT_CULL_DISTANCE,
    INTEGRATED_GPU_HIGH_DETAIL_DISTANCE, INTEGRATED_GPU_CULL_DISTANCE,
};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::materials::VoxelMaterial;
use crate::rendering::triplanar_material::TriplanarMaterialHandle;
use crate::rendering::AmbientOcclusionConfig;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::meshing::{generate_chunk_mesh_with_mode, MeshMode, MeshSettings};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use crate::physics::NeedsCollider;
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

// Simple pseudo-random noise functions for terrain generation
fn hash(x: i32, z: i32) -> f32 {
    let n = x
        .wrapping_mul(374761393)
        .wrapping_add(z.wrapping_mul(668265263));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
}

fn smoothstep(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + t * (b - a)
}

fn value_noise(x: f32, z: f32) -> f32 {
    let xi = x.floor() as i32;
    let zi = z.floor() as i32;
    let xf = x - x.floor();
    let zf = z - z.floor();

    let v00 = hash(xi, zi);
    let v10 = hash(xi + 1, zi);
    let v01 = hash(xi, zi + 1);
    let v11 = hash(xi + 1, zi + 1);

    let u = smoothstep(xf);
    let v = smoothstep(zf);

    lerp(lerp(v00, v10, u), lerp(v01, v11, u), v)
}

fn fbm(x: f32, z: f32, octaves: u32) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = 1.0;
    let mut max_value = 0.0;

    for _ in 0..octaves {
        value += amplitude * value_noise(x * frequency, z * frequency);
        max_value += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    value / max_value
}

/// Calculates terrain height at a given world position using multi-octave noise.
///
/// The terrain is generated using several noise layers:
/// - Base layer for overall terrain shape
/// - Hills for medium-scale variation
/// - Mountains for occasional tall peaks (above threshold)
/// - River valleys that carve into the terrain
fn get_terrain_height(world_x: i32, world_z: i32) -> i32 {
    let x = world_x as f32;
    let z = world_z as f32;

    // Base terrain with multiple noise layers
    let base = fbm(x * TERRAIN_BASE_FREQUENCY, z * TERRAIN_BASE_FREQUENCY, 4)
        * TERRAIN_BASE_AMPLITUDE
        + TERRAIN_BASE_HEIGHT;

    // Hills - larger features
    let hills = fbm(x * TERRAIN_HILL_FREQUENCY, z * TERRAIN_HILL_FREQUENCY, 3) * TERRAIN_HILL_AMPLITUDE;

    // Mountains - occasional tall peaks
    let mountain_mask = fbm(x * TERRAIN_MOUNTAIN_FREQUENCY, z * TERRAIN_MOUNTAIN_FREQUENCY, 2);
    let mountains = if mountain_mask > MOUNTAIN_THRESHOLD {
        (mountain_mask - MOUNTAIN_THRESHOLD) * MOUNTAIN_MULTIPLIER
    } else {
        0.0
    };

    // River valleys - carve into terrain
    let river_noise = (fbm(x * TERRAIN_RIVER_FREQUENCY, z * TERRAIN_RIVER_FREQUENCY, 2) * std::f32::consts::TAU).sin();
    let river_factor = if river_noise.abs() < RIVER_WIDTH_THRESHOLD {
        -RIVER_CARVE_DEPTH * (1.0 - river_noise.abs() / RIVER_WIDTH_THRESHOLD)
    } else {
        0.0
    };

    (base + hills + mountains + river_factor)
        .max(TERRAIN_MIN_HEIGHT)
        .min(TERRAIN_MAX_HEIGHT) as i32
}

/// Determines the biome type at a given world position.
///
/// # Returns
/// - 0: Normal terrain (grass/soil)
/// - 1: Sandy/beach biome
/// - 2: Rocky outcrops
/// - 3: Clay deposits
fn get_biome(world_x: i32, world_z: i32) -> u8 {
    let x = world_x as f32;
    let z = world_z as f32;

    let biome_noise = fbm(x * TERRAIN_BIOME_FREQUENCY, z * TERRAIN_BIOME_FREQUENCY, 2);
    let detail_noise = fbm(x * TERRAIN_CAVE_FREQUENCY, z * TERRAIN_CAVE_FREQUENCY, 2);

    if biome_noise < BIOME_SANDY_THRESHOLD {
        1 // Sandy areas
    } else if biome_noise > BIOME_ROCKY_THRESHOLD && detail_noise > BIOME_ROCKY_DETAIL_THRESHOLD {
        2 // Rocky outcrops
    } else if biome_noise > BIOME_CLAY_MIN && biome_noise < BIOME_CLAY_MAX && detail_noise > BIOME_CLAY_DETAIL_THRESHOLD {
        3 // Clay deposits
    } else {
        0 // Normal terrain
    }
}

/// Determines if a position should be a cave (empty space underground).
///
/// Uses 3D noise to create organic cave shapes, with caves being more
/// common at lower depths.
fn is_cave(world_x: i32, world_y: i32, world_z: i32) -> bool {
    let x = world_x as f32;
    let y = world_y as f32;
    let z = world_z as f32;

    // 3D noise for caves - combine horizontal and vertical frequencies
    let cave_noise = fbm(
        x * TERRAIN_CAVE_FREQUENCY + y * 0.03,
        z * TERRAIN_CAVE_FREQUENCY + y * 0.02,
        3,
    );
    // Caves more common at lower depths
    let cave_threshold = MOUNTAIN_THRESHOLD + (y / 64.0) * 0.1;

    cave_noise > cave_threshold && world_y > 2 && world_y < 45
}

/// Determines if a position is part of a dungeon structure.
///
/// Dungeons are placed on a grid defined by `DUNGEON_SPACING` and consist of:
/// - Entrance staircase from the surface
/// - Floor and ceiling
/// - Outer walls
/// - Inner walls forming corridors with doorways
/// - Pillars at wall intersections
///
/// # Returns
/// - `Some(VoxelType)` if this position is part of a dungeon structure
/// - `None` if this position should use normal terrain generation
fn is_dungeon_wall(world_x: i32, world_y: i32, world_z: i32) -> Option<VoxelType> {
    let dx = ((world_x % DUNGEON_SPACING) + DUNGEON_SPACING) % DUNGEON_SPACING;
    let dz = ((world_z % DUNGEON_SPACING) + DUNGEON_SPACING) % DUNGEON_SPACING;

    // Dungeon entrance staircase - visible from surface
    // Located at corner of each dungeon (position 2-4, 2-4 in dungeon local coords)
    const ENTRANCE_X: i32 = 2;
    const ENTRANCE_Z: i32 = 2;

    if dx >= ENTRANCE_X
        && dx < ENTRANCE_X + DUNGEON_ENTRANCE_SIZE
        && dz >= ENTRANCE_Z
        && dz < ENTRANCE_Z + DUNGEON_ENTRANCE_SIZE
    {
        // Staircase from surface down to dungeon
        if world_y > DUNGEON_FLOOR_Y && world_y <= DUNGEON_ENTRANCE_MAX_Y {
            let stair_local_x = dx - ENTRANCE_X;
            let stair_local_z = dz - ENTRANCE_Z;

            // Create staircase walls
            let is_stair_wall = stair_local_x == 0
                || stair_local_x == DUNGEON_ENTRANCE_SIZE - 1
                || stair_local_z == 0
                || stair_local_z == DUNGEON_ENTRANCE_SIZE - 1;

            // Interior is air (the stairwell)
            if is_stair_wall && stair_local_x != 1 && stair_local_z != 1 {
                return Some(VoxelType::DungeonWall);
            } else {
                return Some(VoxelType::Air);
            }
        }
    }

    // Check if we're in a dungeon area
    if dx < DUNGEON_SIZE
        && dz < DUNGEON_SIZE
        && world_y >= DUNGEON_FLOOR_Y
        && world_y <= DUNGEON_FLOOR_Y + DUNGEON_HEIGHT + 3
    {
        let local_x = dx;
        let local_z = dz;
        let local_y = world_y - DUNGEON_FLOOR_Y;

        if local_y > DUNGEON_HEIGHT {
            return None; // Above dungeon ceiling
        }

        // Outer walls
        let is_outer_wall = local_x == 0
            || local_x == DUNGEON_SIZE - 1
            || local_z == 0
            || local_z == DUNGEON_SIZE - 1;

        // Inner walls forming corridors (on grid spacing)
        let wall_at_x = (local_x % DUNGEON_WALL_SPACING == 0 || local_x % DUNGEON_WALL_SPACING == 1)
            && local_x > 0
            && local_x < DUNGEON_SIZE - 1;
        let wall_at_z = (local_z % DUNGEON_WALL_SPACING == 0 || local_z % DUNGEON_WALL_SPACING == 1)
            && local_z > 0
            && local_z < DUNGEON_SIZE - 1;

        // Doorways in inner walls (at positions 3-5, 11-13, 17-19)
        let doorway_x = (local_z >= 3 && local_z <= 5)
            || (local_z >= 11 && local_z <= 13)
            || (local_z >= 17 && local_z <= 19);
        let doorway_z = (local_x >= 3 && local_x <= 5)
            || (local_x >= 11 && local_x <= 13)
            || (local_x >= 17 && local_x <= 19);

        let is_inner_wall = (wall_at_x && !doorway_x) || (wall_at_z && !doorway_z);

        // Floor and ceiling
        let is_floor = local_y == 0;
        let is_ceiling = local_y == DUNGEON_HEIGHT;

        // Pillars at intersections
        let is_pillar = (local_x % DUNGEON_WALL_SPACING <= 1)
            && (local_z % DUNGEON_WALL_SPACING <= 1)
            && local_x > 0
            && local_x < DUNGEON_SIZE - 1
            && local_z > 0
            && local_z < DUNGEON_SIZE - 1;

        // Don't place ceiling over entrance
        let over_entrance = dx >= ENTRANCE_X
            && dx < ENTRANCE_X + DUNGEON_ENTRANCE_SIZE
            && dz >= ENTRANCE_Z
            && dz < ENTRANCE_Z + DUNGEON_ENTRANCE_SIZE;

        if is_floor {
            return Some(VoxelType::DungeonFloor);
        } else if is_ceiling && !over_entrance {
            return Some(VoxelType::DungeonFloor);
        } else if is_outer_wall || is_inner_wall || is_pillar {
            return Some(VoxelType::DungeonWall);
        } else {
            return Some(VoxelType::Air);
        }
    }

    None
}

/// Determines if a tree should spawn at a given location.
///
/// Trees spawn based on a pseudo-random hash with approximately 2% probability,
/// but only on terrain sufficiently above water level.
fn should_spawn_tree(world_x: i32, world_z: i32, terrain_height: i32) -> bool {
    // Trees only spawn above water level on grass
    if terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET {
        return false;
    }

    // Use hash to determine tree placement - sparse distribution
    let tree_noise = hash(world_x.wrapping_mul(7), world_z.wrapping_mul(13));
    tree_noise > TREE_SPAWN_THRESHOLD
}

/// Gets the height of a tree at a given location.
///
/// Uses deterministic hashing so the same position always produces the same height.
fn get_tree_height(world_x: i32, world_z: i32) -> i32 {
    let h = hash(world_x.wrapping_add(1000), world_z.wrapping_add(2000));
    TREE_MIN_HEIGHT + (h * TREE_HEIGHT_VARIANCE as f32) as i32
}

/// Determines if a position is part of a tree trunk.
fn is_tree_trunk(world_x: i32, world_y: i32, world_z: i32, terrain_height: i32) -> bool {
    if !should_spawn_tree(world_x, world_z, terrain_height) {
        return false;
    }

    let trunk_height = get_tree_height(world_x, world_z);
    let trunk_bottom = terrain_height + 1;
    let trunk_top = trunk_bottom + trunk_height;

    world_y >= trunk_bottom && world_y < trunk_top
}

/// Determines if a position is part of tree leaves.
///
/// Searches nearby positions for trees and checks if this position falls
/// within their spherical leaf canopy.
fn is_tree_leaves(world_x: i32, world_y: i32, world_z: i32) -> bool {
    for dx in -TREE_LEAF_CHECK_RADIUS..=TREE_LEAF_CHECK_RADIUS {
        for dz in -TREE_LEAF_CHECK_RADIUS..=TREE_LEAF_CHECK_RADIUS {
            let check_x = world_x + dx;
            let check_z = world_z + dz;

            let check_height = get_terrain_height(check_x, check_z);

            if should_spawn_tree(check_x, check_z, check_height) {
                let trunk_height = get_tree_height(check_x, check_z);
                let trunk_top = check_height + 1 + trunk_height;
                let leaf_center_y = trunk_top - 1;

                // Spherical leaf shape (slightly flattened vertically)
                let dx_f = dx as f32;
                let dz_f = dz as f32;
                let dy_f = (world_y - leaf_center_y) as f32;

                let dist_sq = dx_f * dx_f + dy_f * dy_f * 1.5 + dz_f * dz_f;

                if dist_sq < TREE_LEAF_RADIUS * TREE_LEAF_RADIUS {
                    // Don't place leaves where trunk is
                    if !(dx == 0 && dz == 0 && world_y < trunk_top) {
                        return true;
                    }
                }
            }
        }
    }

    false
}

/// Debug flag to generate a flat world for testing. Disabled by default.
const DEBUG_FLAT_WORLD: bool = false;

fn setup_voxel_world(mut world: ResMut<VoxelWorld>, persistence_settings: Res<WorldPersistence>) {
    // Try to load saved world unless force_regenerate is set
    if !persistence_settings.force_regenerate && persistence::saved_world_exists() {
        info!("Loading saved world from disk...");
        match persistence::load_world() {
            Ok(loaded_world) => {
                *world = loaded_world;
                info!("World loaded successfully!");
                return;
            }
            Err(e) => {
                warn!("Failed to load saved world: {}. Generating new world...", e);
            }
        }
    }

    info!("Generating new world...");
    let start_time = std::time::Instant::now();

    // Generate extensive procedural terrain
    let chunk_positions: Vec<IVec3> = world.all_chunk_positions().collect();
    let mut total_sand = 0u32;
    let mut total_dungeon_wall = 0u32;
    let mut total_dungeon_floor = 0u32;

    for chunk_pos in chunk_positions {
        let mut chunk = Chunk::new(chunk_pos);
        let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
        let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
        let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;
        let mut sand_count = 0u32;
        let mut dungeon_wall_count = 0u32;
        let mut dungeon_floor_count = 0u32;

        for x in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                let world_x = chunk_world_x + x as i32;
                let world_z = chunk_world_z + z as i32;

                let terrain_height = get_terrain_height(world_x, world_z);
                let biome = get_biome(world_x, world_z);

                for y in 0..CHUNK_SIZE {
                    let world_y = chunk_world_y + y as i32;

                    // Check for dungeon structures first
                    if let Some(dungeon_voxel) = is_dungeon_wall(world_x, world_y, world_z) {
                        match dungeon_voxel {
                            VoxelType::DungeonWall => dungeon_wall_count += 1,
                            VoxelType::DungeonFloor => dungeon_floor_count += 1,
                            _ => {}
                        }
                        chunk.set(UVec3::new(x as u32, y as u32, z as u32), dungeon_voxel);
                        continue;
                    }

                    // Check for caves
                    // Caves disabled for debugging blue holes
                    if is_cave(world_x, world_y, world_z) && world_y < terrain_height - 3 {
                        // Fill caves below water level with water
                        let voxel = if world_y <= WATER_LEVEL {
                            VoxelType::Water
                        } else {
                            VoxelType::Air
                        };
                        chunk.set(UVec3::new(x as u32, y as u32, z as u32), voxel);
                        continue;
                    }

                    // Check for tree trunks
                    if is_tree_trunk(world_x, world_y, world_z, terrain_height) {
                        chunk.set(UVec3::new(x as u32, y as u32, z as u32), VoxelType::Wood);
                        continue;
                    }

                    // Check for tree leaves
                    if world_y > terrain_height && is_tree_leaves(world_x, world_y, world_z) {
                        chunk.set(UVec3::new(x as u32, y as u32, z as u32), VoxelType::Leaves);
                        continue;
                    }

                    let voxel = if DEBUG_FLAT_WORLD {
                        if world_y <= 12 {
                            VoxelType::TopSoil
                        } else {
                            VoxelType::Air
                        }
                    } else if world_y > terrain_height {
                        // Above terrain - check if below water level (lakes/rivers)
                        if world_y <= WATER_LEVEL {
                            VoxelType::Water
                        } else {
                            VoxelType::Air
                        }
                    } else if world_y == 0 {
                        VoxelType::Bedrock
                    } else if world_y <= 3 {
                        // Deep bedrock layer with some rock
                        if hash(world_x, world_z + world_y * 1000) > 0.3 {
                            VoxelType::Bedrock
                        } else {
                            VoxelType::Rock
                        }
                    } else {
                        // Determine block based on depth from surface and biome
                        let depth = terrain_height - world_y;

                        // Near water, use sand instead of topsoil (beaches and shorelines)
                        let near_water = terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET;

                        match biome {
                            1 => {
                                // Sandy biome
                                if depth <= 4 {
                                    VoxelType::Sand
                                } else if depth <= 8 {
                                    VoxelType::SubSoil
                                } else {
                                    VoxelType::Rock
                                }
                            }
                            2 => {
                                // Rocky biome
                                if depth <= 1 {
                                    VoxelType::Rock
                                } else if depth <= 3 {
                                    VoxelType::SubSoil
                                } else {
                                    VoxelType::Rock
                                }
                            }
                            3 => {
                                // Clay deposits
                                if near_water {
                                    if depth <= 2 {
                                        VoxelType::Sand
                                    } else if depth <= 6 {
                                        VoxelType::Clay
                                    } else {
                                        VoxelType::Rock
                                    }
                                } else if depth <= 2 {
                                    VoxelType::TopSoil
                                } else if depth <= 6 {
                                    VoxelType::Clay
                                } else if depth <= 10 {
                                    VoxelType::SubSoil
                                } else {
                                    VoxelType::Rock
                                }
                            }
                            _ => {
                                // Normal terrain - use sand near water (beaches)
                                if near_water {
                                    if depth <= BEACH_HEIGHT_OFFSET as i32 {
                                        VoxelType::Sand
                                    } else if depth <= 5 {
                                        VoxelType::SubSoil
                                    } else {
                                        VoxelType::Rock
                                    }
                                } else if depth == 0 {
                                    VoxelType::TopSoil
                                } else if depth <= 4 {
                                    VoxelType::SubSoil
                                } else {
                                    VoxelType::Rock
                                }
                            }
                        }
                    };

                    if voxel == VoxelType::Sand {
                        sand_count += 1;
                    }
                    chunk.set(UVec3::new(x as u32, y as u32, z as u32), voxel);
                }
            }
        }

        chunk.mark_dirty();
        world.insert_chunk(chunk);

        total_sand += sand_count;
        total_dungeon_wall += dungeon_wall_count;
        total_dungeon_floor += dungeon_floor_count;

        if dungeon_wall_count > 0 || dungeon_floor_count > 0 {
            info!(
                "Chunk {:?} (world pos {:?}) has {} dungeon walls, {} dungeon floors",
                chunk_pos,
                IVec3::new(chunk_world_x, chunk_world_y, chunk_world_z),
                dungeon_wall_count,
                dungeon_floor_count
            );
        }
    }

    let generation_time = start_time.elapsed();
    info!("=== WORLD GENERATION SUMMARY ===");
    info!("Generation time: {:.2}s", generation_time.as_secs_f32());
    info!("Total sand blocks: {}", total_sand);
    info!("Total dungeon wall blocks: {}", total_dungeon_wall);
    info!("Total dungeon floor blocks: {}", total_dungeon_floor);
    info!("Dungeons should be at positions like (0-19, 3-18, 0-19), (96-115, 3-18, 96-115), etc.");
    info!("Sand appears near water (terrain height <= 24) and in sandy biomes");

    // Save world to disk if auto_save is enabled
    if persistence_settings.auto_save {
        info!("Saving world to disk...");
        match persistence::save_world(&world) {
            Ok(()) => info!("World saved successfully!"),
            Err(e) => warn!("Failed to save world: {}", e),
        }
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
) {
    // Bail out until the blocky material is ready to avoid panicking when resources are still loading.
    let blocky_material = match blocky_material {
        Some(mat) => mat,
        None => return,
    };

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
                        MeshMode::Blocky => commands
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
                            .id(),
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
