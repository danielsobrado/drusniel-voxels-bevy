//! Global constants for the voxel engine.
//!
//! This module centralizes all magic numbers and configuration constants
//! to ensure consistency across the codebase and make tuning easier.

// =============================================================================
// Chunk Dimensions
// =============================================================================

/// Number of voxels along each axis of a chunk (16x16x16).
pub const CHUNK_SIZE: usize = 16;

/// Chunk size as i32 for coordinate calculations.
pub const CHUNK_SIZE_I32: i32 = CHUNK_SIZE as i32;

/// Chunk size as f32 for floating-point calculations.
pub const CHUNK_SIZE_F32: f32 = CHUNK_SIZE as f32;

/// Chunk size as u32 for unsigned coordinate calculations.
pub const CHUNK_SIZE_U32: u32 = CHUNK_SIZE as u32;

/// Total number of voxels in a chunk (16^3 = 4096).
pub const CHUNK_VOLUME: usize = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/// Padded chunk size for Surface Nets meshing.
/// Surface Nets needs +1 padding on each side to sample neighboring voxels,
/// resulting in an 18x18x18 sample grid for a 16x16x16 chunk.
pub const PADDED_CHUNK_SIZE: usize = CHUNK_SIZE + 2;

/// Padded chunk size as u32 for ndshape.
pub const PADDED_CHUNK_SIZE_U32: u32 = PADDED_CHUNK_SIZE as u32;

// =============================================================================
// World Defaults (can be overridden by config)
// =============================================================================

/// Default world size in chunks along X axis.
pub const DEFAULT_WORLD_CHUNKS_X: i32 = 32;

/// Default world size in chunks along Y axis (vertical).
pub const DEFAULT_WORLD_CHUNKS_Y: i32 = 4;

/// Default world size in chunks along Z axis.
pub const DEFAULT_WORLD_CHUNKS_Z: i32 = 32;

// =============================================================================
// Texture Atlas Configuration
// =============================================================================

/// Size of each tile in the texture atlas in pixels.
pub const ATLAS_TILE_SIZE: u32 = 256;

/// Number of columns in the texture atlas grid.
pub const ATLAS_COLUMNS: u32 = 4;

/// Number of rows in the texture atlas grid.
pub const ATLAS_ROWS: u32 = 4;

/// UV padding to prevent texture bleeding from adjacent atlas tiles.
/// This insets UVs slightly from tile boundaries.
pub const UV_PADDING: f32 = 0.02;

// =============================================================================
// Meshing Constants
// =============================================================================

/// Size of a single voxel in world units.
pub const VOXEL_SIZE: f32 = 1.0;

/// Scale factor applied to chunk meshes to create slight overlap at boundaries.
/// Set to 1.0 (no scaling) because scaling from chunk center causes boundary
/// vertices to be positioned differently in adjacent chunks, creating seams.
pub const CHUNK_BOUNDARY_SCALE: f32 = 1.0;

// =============================================================================
// Terrain Generation
// =============================================================================

/// Water level in world Y coordinates. Areas below this height are filled with water.
pub const WATER_LEVEL: i32 = 18;

/// Base terrain noise frequency for large-scale features.
pub const TERRAIN_BASE_FREQUENCY: f32 = 0.008;

/// Hill noise frequency for medium-scale terrain variation.
pub const TERRAIN_HILL_FREQUENCY: f32 = 0.02;

/// Mountain mask frequency for determining mountain placement.
pub const TERRAIN_MOUNTAIN_FREQUENCY: f32 = 0.005;

/// River noise frequency for carving river valleys.
pub const TERRAIN_RIVER_FREQUENCY: f32 = 0.015;

/// Biome noise frequency for biome distribution.
pub const TERRAIN_BIOME_FREQUENCY: f32 = 0.01;

/// Cave noise frequency for 3D cave generation.
pub const TERRAIN_CAVE_FREQUENCY: f32 = 0.05;

/// Minimum terrain height (clamped).
pub const TERRAIN_MIN_HEIGHT: f32 = 1.0;

/// Maximum terrain height (clamped).
pub const TERRAIN_MAX_HEIGHT: f32 = 120.0;

/// Base terrain height offset (minimum base height).
pub const TERRAIN_BASE_HEIGHT: f32 = 16.0;

/// Amplitude of base terrain noise.
pub const TERRAIN_BASE_AMPLITUDE: f32 = 20.0;

/// Amplitude of hill noise.
pub const TERRAIN_HILL_AMPLITUDE: f32 = 10.0;

/// Mountain threshold - noise values above this create mountains.
pub const MOUNTAIN_THRESHOLD: f32 = 0.35;

/// Mountain height multiplier for noise values above threshold.
pub const MOUNTAIN_MULTIPLIER: f32 = 150.0;

/// River width threshold - noise values below this create river valleys.
pub const RIVER_WIDTH_THRESHOLD: f32 = 0.2;

/// Maximum depth of river valley carving.
pub const RIVER_CARVE_DEPTH: f32 = 10.0;

// =============================================================================
// Tree Generation
// =============================================================================

/// Probability threshold for tree spawning (higher = fewer trees).
/// A value of 0.98 means ~2% of valid positions will spawn trees.
pub const TREE_SPAWN_THRESHOLD: f32 = 0.8;

/// Minimum tree trunk height.
pub const TREE_MIN_HEIGHT: i32 = 3;

/// Additional random height range for trees.
pub const TREE_HEIGHT_VARIANCE: i32 = 3;

/// Radius to check for nearby trees when generating leaves.
pub const TREE_LEAF_CHECK_RADIUS: i32 = 3;

/// Radius of spherical leaf canopy.
pub const TREE_LEAF_RADIUS: f32 = 2.5;

// =============================================================================
// Dungeon Generation
// =============================================================================

/// Spacing between dungeon structures in world units.
pub const DUNGEON_SPACING: i32 = 96;

/// Size of dungeon floor area.
pub const DUNGEON_SIZE: i32 = 20;

/// Y-level of dungeon floors.
pub const DUNGEON_FLOOR_Y: i32 = 3;

/// Interior height of dungeon rooms.
pub const DUNGEON_HEIGHT: i32 = 12;

/// Size of dungeon entrance stairwell.
pub const DUNGEON_ENTRANCE_SIZE: i32 = 3;

/// Maximum Y-level for dungeon entrance shaft.
pub const DUNGEON_ENTRANCE_MAX_Y: i32 = 50;

/// Grid spacing for inner dungeon walls.
pub const DUNGEON_WALL_SPACING: i32 = 8;

// =============================================================================
// Biome Thresholds
// =============================================================================

/// Noise threshold below which sandy biome is generated.
pub const BIOME_SANDY_THRESHOLD: f32 = 0.25;

/// Noise threshold above which rocky biome is possible.
pub const BIOME_ROCKY_THRESHOLD: f32 = 0.75;

/// Detail noise threshold for rocky outcrops.
pub const BIOME_ROCKY_DETAIL_THRESHOLD: f32 = 0.5;

/// Noise range for clay deposits (min).
pub const BIOME_CLAY_MIN: f32 = 0.4;

/// Noise range for clay deposits (max).
pub const BIOME_CLAY_MAX: f32 = 0.5;

/// Detail noise threshold for clay deposits.
pub const BIOME_CLAY_DETAIL_THRESHOLD: f32 = 0.6;

/// Height above water level considered "near water" for beach generation.
pub const BEACH_HEIGHT_OFFSET: i32 = 2;

// =============================================================================
// LOD (Level of Detail) Settings
// =============================================================================

/// Default distance in world units for high detail meshing.
/// Increased from 96 to 160 for smoother LOD transitions.
pub const DEFAULT_HIGH_DETAIL_DISTANCE: f32 = 160.0;

/// Default distance in world units at which chunks are culled entirely.
/// Increased from 192 to 400 to cover more of the 512x512 world and
/// prevent props from appearing without terrain.
pub const DEFAULT_CULL_DISTANCE: f32 = 400.0;

/// High detail distance for integrated GPUs (more aggressive culling).
pub const INTEGRATED_GPU_HIGH_DETAIL_DISTANCE: f32 = 64.0;

/// Cull distance for integrated GPUs.
pub const INTEGRATED_GPU_CULL_DISTANCE: f32 = 160.0;

/// Hysteresis buffer to prevent rapid LOD switching at boundaries.
/// Camera must move this far past threshold before LOD changes.
pub const LOD_HYSTERESIS: f32 = 10.0;

/// Distance in world units where voxel water uses the fancy water shader.
pub const WATER_FANCY_DISTANCE: f32 = 64.0;

/// Hysteresis buffer for switching water materials near the threshold.
pub const WATER_FANCY_HYSTERESIS: f32 = 8.0;

/// Interval in seconds for updating water material LODs.
pub const WATER_MATERIAL_UPDATE_INTERVAL: f32 = 0.25;

/// Minimum water mesh triangle count before enabling the fancy shader.
pub const WATER_FANCY_MIN_TRIANGLES: usize = 200;

/// Minimum vertical water depth (voxels) before enabling the fancy shader.
pub const WATER_FANCY_MIN_DEPTH: usize = 3;

/// Wave amplitude multiplier for voxel water using the fancy shader.
pub const VOXEL_WATER_WAVE_AMPLITUDE_MULT: f32 = 1.6;

/// UV scale multiplier to increase visible wave detail on voxel water.
pub const VOXEL_WATER_WAVE_UV_SCALE: f32 = 4.0;

/// Water clarity multiplier to keep shallow voxel water visible.
pub const VOXEL_WATER_CLARITY_MULT: f32 = 2.5;

/// Edge scale multiplier for voxel water edge blending.
pub const VOXEL_WATER_EDGE_SCALE_MULT: f32 = 0.6;

/// Small vertical offset to reduce z-fighting between water and terrain.
/// Zero offset keeps water at actual surface level; depth_bias handles z-fighting.
pub const WATER_SURFACE_OFFSET: f32 = 0.0;

// =============================================================================
// LOD Mesh Grid Configurations
// =============================================================================
// These define the voxel sampling grids for different LOD levels.
// Lower LOD uses larger step sizes (sampling fewer voxels) for simpler meshes.

/// LOD 0 (High Detail): Full resolution sampling
/// Grid: 18x18x18 (16 chunk + 2 padding), samples every voxel
pub const LOD0_PADDED_SIZE: u32 = 18;
pub const LOD0_STEP_SIZE: u32 = 1;
pub const LOD0_GRID_VOLUME: usize = 5832; // 18^3

/// LOD 1 (Low Detail): Half resolution sampling
/// Grid: 10x10x10 ((16/2) + 2 padding), samples every 2nd voxel
/// Reduces vertex count by ~75%
pub const LOD1_PADDED_SIZE: u32 = 10;
pub const LOD1_STEP_SIZE: u32 = 2;
pub const LOD1_GRID_VOLUME: usize = 1000; // 10^3

/// LOD 2 (Very Low Detail): Quarter resolution sampling (future use)
/// Grid: 6x6x6 ((16/4) + 2 padding), samples every 4th voxel
/// Reduces vertex count by ~94%
pub const LOD2_PADDED_SIZE: u32 = 6;
pub const LOD2_STEP_SIZE: u32 = 4;
pub const LOD2_GRID_VOLUME: usize = 216; // 6^3

// =============================================================================
// Interaction Constants
// =============================================================================

/// Maximum distance for block interaction (breaking/placing).
pub const INTERACTION_RANGE: f32 = 6.0;

/// Raycast step size for block detection.
pub const RAY_STEP: f32 = 0.1;

/// Cone angle threshold for entity targeting (dot product, ~25 degree cone).
pub const ENTITY_TARGET_CONE: f32 = 0.9;

/// Collision radius for entity targeting.
pub const ENTITY_TARGET_RADIUS: f32 = 1.5;

/// Damage dealt per attack.
pub const ATTACK_DAMAGE: f32 = 10.0;

// =============================================================================
// GPU Requirements
// =============================================================================

/// Minimum required sampled textures per shader stage.
/// BuildingMaterial(17) + Bevy internals + headroom.
pub const MIN_TEXTURES_PER_STAGE: u32 = 64;

/// Minimum required samplers per shader stage.
pub const MIN_SAMPLERS_PER_STAGE: u32 = 64;

/// Fallback storage textures for when GPU detection fails.
pub const FALLBACK_STORAGE_TEXTURES: u32 = 8;

/// Fallback bind groups for when GPU detection fails.
pub const FALLBACK_BIND_GROUPS: u32 = 8;

// =============================================================================
// Player Configuration Defaults
// =============================================================================

/// Default player walking speed in units per second.
pub const DEFAULT_WALK_SPEED: f32 = 8.0;

/// Default player running speed in units per second.
pub const DEFAULT_RUN_SPEED: f32 = 16.0;

/// Default jump height in world units.
pub const DEFAULT_JUMP_HEIGHT: f32 = 4.0;

/// Default float height for physics ground detection.
pub const DEFAULT_FLOAT_HEIGHT: f32 = 1.5;

/// Default player capsule collider radius.
pub const DEFAULT_CAPSULE_RADIUS: f32 = 0.45;

/// Default player capsule collider height.
pub const DEFAULT_CAPSULE_HEIGHT: f32 = 1.8;

// =============================================================================
// Cave Generation
// =============================================================================

/// Maximum Y level for cave generation.
pub const CAVE_MAX_Y: i32 = 45;

/// Minimum Y level for cave generation (above bedrock).
pub const CAVE_MIN_Y: i32 = 2;

/// Minimum depth below terrain surface for caves.
pub const CAVE_SURFACE_OFFSET: i32 = 3;

// =============================================================================
// Bedrock Generation
// =============================================================================

/// World Y coordinate for the bedrock floor.
pub const BEDROCK_DEPTH: i32 = 0;

/// Smooth transition thickness for bedrock blending in SDF.
pub const BEDROCK_BLEND: f32 = 2.0;
