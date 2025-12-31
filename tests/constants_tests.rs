//! Sanity checks for constant relationships and invariants.

use voxel_builder::constants::*;

#[test]
fn chunk_size_casts_are_consistent() {
    assert_eq!(CHUNK_SIZE_I32, CHUNK_SIZE as i32);
    assert_eq!(CHUNK_SIZE_F32, CHUNK_SIZE as f32);
}

#[test]
fn chunk_volume_is_cube() {
    assert_eq!(CHUNK_VOLUME, CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
}

#[test]
fn padded_chunk_size_includes_border() {
    assert_eq!(PADDED_CHUNK_SIZE, CHUNK_SIZE + 2);
    assert_eq!(PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE as u32);
}

#[test]
fn chunk_size_is_power_of_two() {
    assert!(CHUNK_SIZE.is_power_of_two(), "Chunk size should be power of 2 for efficient indexing");
}

#[test]
fn terrain_height_bounds_are_valid() {
    assert!(TERRAIN_MIN_HEIGHT < TERRAIN_MAX_HEIGHT);
    assert!(TERRAIN_BASE_HEIGHT >= TERRAIN_MIN_HEIGHT);
    assert!(TERRAIN_BASE_HEIGHT <= TERRAIN_MAX_HEIGHT);
}

#[test]
fn water_level_is_reasonable() {
    assert!(WATER_LEVEL > 0);
    assert!((WATER_LEVEL as f32) < TERRAIN_MAX_HEIGHT);
}

#[test]
fn tree_generation_values_are_sane() {
    assert!(TREE_SPAWN_THRESHOLD > 0.0 && TREE_SPAWN_THRESHOLD < 1.0);
    assert!(TREE_MIN_HEIGHT > 0);
    assert!(TREE_HEIGHT_VARIANCE >= 0);
    assert!(TREE_LEAF_RADIUS > 0.0);
}

#[test]
fn dungeon_values_are_consistent() {
    assert!(DUNGEON_SIZE > 0);
    assert!(DUNGEON_HEIGHT > 0);
    assert!(DUNGEON_FLOOR_Y >= 0);
    assert!(DUNGEON_ENTRANCE_MAX_Y > DUNGEON_FLOOR_Y + DUNGEON_HEIGHT);
}

#[test]
fn biome_thresholds_are_ordered() {
    assert!(BIOME_SANDY_THRESHOLD < BIOME_ROCKY_THRESHOLD);
    assert!(BIOME_CLAY_MIN < BIOME_CLAY_MAX);
}

#[test]
fn lod_distances_are_ordered() {
    assert!(DEFAULT_HIGH_DETAIL_DISTANCE < DEFAULT_CULL_DISTANCE);
    assert!(INTEGRATED_GPU_HIGH_DETAIL_DISTANCE < INTEGRATED_GPU_CULL_DISTANCE);
}

#[test]
fn interaction_constants_are_positive() {
    assert!(INTERACTION_RANGE > 0.0);
    assert!(RAY_STEP > 0.0);
    assert!(RAY_STEP < INTERACTION_RANGE, "Ray step should be smaller than range");
    assert!(ENTITY_TARGET_CONE > 0.0 && ENTITY_TARGET_CONE <= 1.0);
    assert!(ENTITY_TARGET_RADIUS > 0.0);
    assert!(ATTACK_DAMAGE > 0.0);
}

#[test]
fn atlas_configuration_valid() {
    assert!(ATLAS_TILE_SIZE > 0);
    assert!(ATLAS_COLUMNS > 0);
    assert!(ATLAS_ROWS > 0);
    assert!(UV_PADDING >= 0.0 && UV_PADDING < 0.5);
}

#[test]
fn gpu_requirements_are_reasonable() {
    assert!(MIN_TEXTURES_PER_STAGE >= 16);
    assert!(MIN_SAMPLERS_PER_STAGE >= 16);
    assert!(FALLBACK_STORAGE_TEXTURES > 0);
    assert!(FALLBACK_BIND_GROUPS > 0);
}

#[test]
fn voxel_size_is_unit() {
    assert_eq!(VOXEL_SIZE, 1.0, "Voxel size should be 1.0 for simple coordinate math");
}

#[test]
fn chunk_boundary_scale_slightly_larger() {
    assert!(CHUNK_BOUNDARY_SCALE > 1.0);
    assert!(CHUNK_BOUNDARY_SCALE < 1.1, "Scale should be subtle to avoid visual artifacts");
}

#[test]
fn noise_frequencies_are_positive() {
    assert!(TERRAIN_BASE_FREQUENCY > 0.0);
    assert!(TERRAIN_HILL_FREQUENCY > 0.0);
    assert!(TERRAIN_MOUNTAIN_FREQUENCY > 0.0);
    assert!(TERRAIN_RIVER_FREQUENCY > 0.0);
    assert!(TERRAIN_BIOME_FREQUENCY > 0.0);
    assert!(TERRAIN_CAVE_FREQUENCY > 0.0);
}

#[test]
fn world_defaults_are_positive() {
    assert!(DEFAULT_WORLD_CHUNKS_X > 0);
    assert!(DEFAULT_WORLD_CHUNKS_Y > 0);
    assert!(DEFAULT_WORLD_CHUNKS_Z > 0);
}
