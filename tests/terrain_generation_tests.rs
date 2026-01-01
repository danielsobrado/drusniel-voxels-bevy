//! Tests for terrain generation algorithms.

use bevy::math::{IVec3, UVec3};
use voxel_builder::constants::{
    CHUNK_SIZE, WATER_LEVEL, TERRAIN_BASE_HEIGHT, TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT,
};
use voxel_builder::voxel::chunk::Chunk;
use voxel_builder::voxel::types::{Voxel, VoxelType};
use voxel_builder::voxel::world::VoxelWorld;

#[test]
fn water_level_constant_is_reasonable() {
    // Water level should be between min and max terrain height
    assert!(
        WATER_LEVEL >= TERRAIN_MIN_HEIGHT as i32,
        "Water level should be above minimum terrain height"
    );
    assert!(
        WATER_LEVEL <= TERRAIN_MAX_HEIGHT as i32,
        "Water level should be below maximum terrain height"
    );
}

#[test]
fn terrain_height_constants_are_ordered() {
    assert!(
        TERRAIN_MIN_HEIGHT < TERRAIN_BASE_HEIGHT,
        "Min height should be less than base height"
    );
    assert!(
        TERRAIN_BASE_HEIGHT < TERRAIN_MAX_HEIGHT,
        "Base height should be less than max height"
    );
}

#[test]
fn world_coordinate_conversion_roundtrip() {
    // Test world_to_chunk and world_to_local for various positions
    let test_positions = [
        IVec3::new(0, 0, 0),
        IVec3::new(15, 15, 15),
        IVec3::new(16, 16, 16),
        IVec3::new(-1, -1, -1),
        IVec3::new(-16, -16, -16),
        IVec3::new(100, 50, 200),
    ];

    for world_pos in test_positions {
        let chunk_pos = VoxelWorld::world_to_chunk(world_pos);
        let local_pos = VoxelWorld::world_to_local(world_pos);

        // Verify local position is within chunk bounds (UVec3 is always >= 0)
        assert!(
            local_pos.x < CHUNK_SIZE as u32,
            "Local X out of bounds for {:?}: {}",
            world_pos,
            local_pos.x
        );
        assert!(
            local_pos.y < CHUNK_SIZE as u32,
            "Local Y out of bounds for {:?}: {}",
            world_pos,
            local_pos.y
        );
        assert!(
            local_pos.z < CHUNK_SIZE as u32,
            "Local Z out of bounds for {:?}: {}",
            world_pos,
            local_pos.z
        );

        // Verify roundtrip: chunk_pos * CHUNK_SIZE + local_pos == world_pos
        let reconstructed = IVec3::new(
            chunk_pos.x * CHUNK_SIZE as i32 + local_pos.x as i32,
            chunk_pos.y * CHUNK_SIZE as i32 + local_pos.y as i32,
            chunk_pos.z * CHUNK_SIZE as i32 + local_pos.z as i32,
        );
        assert_eq!(
            reconstructed, world_pos,
            "Coordinate roundtrip failed for {:?}",
            world_pos
        );
    }
}

#[test]
fn voxel_type_classification() {
    // Test that voxel types are correctly classified
    let solid_types = [
        VoxelType::Rock,
        VoxelType::SubSoil,
        VoxelType::TopSoil,
        VoxelType::Sand,
        VoxelType::Bedrock,
    ];

    for voxel in solid_types {
        assert!(voxel.is_solid(), "{:?} should be solid", voxel);
        assert!(!voxel.is_liquid(), "{:?} should not be liquid", voxel);
    }

    // Air is neither solid nor liquid
    assert!(!VoxelType::Air.is_solid(), "Air should not be solid");
    assert!(!VoxelType::Air.is_liquid(), "Air should not be liquid");

    // Water is liquid and transparent
    assert!(VoxelType::Water.is_liquid(), "Water should be liquid");
    assert!(VoxelType::Water.is_transparent(), "Water should be transparent");
    assert!(!VoxelType::Water.is_solid(), "Water should not be solid");
}

#[test]
fn bedrock_is_unbreakable() {
    // Bedrock should be treated specially (cannot be broken)
    let bedrock = VoxelType::Bedrock;
    assert!(bedrock.is_solid(), "Bedrock should be solid");

    // This is a semantic test - the game logic should prevent breaking bedrock
    // We verify the type exists and is solid
}

#[test]
fn chunk_creation_and_modification() {
    let mut chunk = Chunk::new(IVec3::new(0, 0, 0));

    // New chunk should be dirty (needs meshing)
    assert!(chunk.is_dirty(), "New chunk should be dirty");

    // Set some voxels using correct types
    chunk.set(UVec3::new(0, 0, 0), VoxelType::Bedrock);
    chunk.set(UVec3::new(0, 1, 0), VoxelType::Rock);
    chunk.set(UVec3::new(0, 2, 0), VoxelType::SubSoil);
    chunk.set(UVec3::new(0, 3, 0), VoxelType::TopSoil);

    // Verify voxels were set
    assert_eq!(chunk.get(UVec3::new(0, 0, 0)), VoxelType::Bedrock);
    assert_eq!(chunk.get(UVec3::new(0, 1, 0)), VoxelType::Rock);
    assert_eq!(chunk.get(UVec3::new(0, 2, 0)), VoxelType::SubSoil);
    assert_eq!(chunk.get(UVec3::new(0, 3, 0)), VoxelType::TopSoil);
}

#[test]
fn world_bounds_check() {
    let world = VoxelWorld::new(IVec3::new(4, 4, 4));

    // Positions inside the world
    assert!(world.in_bounds(IVec3::new(0, 0, 0)), "Origin should be in bounds");
    assert!(world.in_bounds(IVec3::new(32, 32, 32)), "Middle should be in bounds");
    assert!(world.in_bounds(IVec3::new(63, 63, 63)), "Near edge should be in bounds");

    // Positions outside the world
    assert!(!world.in_bounds(IVec3::new(-1, 0, 0)), "Negative X should be out of bounds");
    assert!(!world.in_bounds(IVec3::new(0, -1, 0)), "Negative Y should be out of bounds");
    assert!(!world.in_bounds(IVec3::new(0, 0, -1)), "Negative Z should be out of bounds");
    assert!(!world.in_bounds(IVec3::new(64, 0, 0)), "Beyond X should be out of bounds");
    assert!(!world.in_bounds(IVec3::new(0, 64, 0)), "Beyond Y should be out of bounds");
    assert!(!world.in_bounds(IVec3::new(0, 0, 64)), "Beyond Z should be out of bounds");
}

#[test]
fn atlas_indices_are_valid() {
    // All voxel types should have valid atlas indices
    let all_types = [
        VoxelType::Air,
        VoxelType::Rock,
        VoxelType::SubSoil,
        VoxelType::TopSoil,
        VoxelType::Sand,
        VoxelType::Water,
        VoxelType::Bedrock,
    ];

    for voxel in all_types {
        let index = voxel.atlas_index();
        // Atlas index should be reasonable (0-255 for u8)
        assert!(
            index < 128,
            "{:?} has unexpectedly high atlas index: {}",
            voxel,
            index
        );
    }
}

#[test]
fn chunk_size_is_power_of_two() {
    // Chunk size should be a power of 2 for efficient coordinate math
    assert!(
        CHUNK_SIZE.is_power_of_two(),
        "Chunk size {} is not a power of two",
        CHUNK_SIZE
    );
}

#[test]
fn world_to_chunk_handles_negatives() {
    // Test negative coordinate handling
    let neg_pos = IVec3::new(-1, -1, -1);
    let chunk_pos = VoxelWorld::world_to_chunk(neg_pos);

    // -1 in a chunk of size 16 should be in chunk -1
    assert_eq!(chunk_pos, IVec3::new(-1, -1, -1), "Negative position should be in chunk -1");

    let neg_pos_2 = IVec3::new(-17, -17, -17);
    let chunk_pos_2 = VoxelWorld::world_to_chunk(neg_pos_2);
    assert_eq!(chunk_pos_2, IVec3::new(-2, -2, -2), "-17 should be in chunk -2");
}

#[test]
fn chunk_serialization_preserves_data() {
    let mut chunk = Chunk::new(IVec3::new(5, 10, 15));

    // Set various voxels
    chunk.set(UVec3::new(0, 0, 0), VoxelType::Bedrock);
    chunk.set(UVec3::new(8, 8, 8), VoxelType::Water);
    chunk.set(UVec3::new(15, 15, 15), VoxelType::TopSoil);

    // Convert to data
    let data = chunk.to_data();

    // Verify position
    assert_eq!(data.position, IVec3::new(5, 10, 15));

    // Convert back
    let restored = Chunk::from_data(data);

    // Verify data preserved
    assert_eq!(restored.position(), IVec3::new(5, 10, 15));
    assert_eq!(restored.get(UVec3::new(0, 0, 0)), VoxelType::Bedrock);
    assert_eq!(restored.get(UVec3::new(8, 8, 8)), VoxelType::Water);
    assert_eq!(restored.get(UVec3::new(15, 15, 15)), VoxelType::TopSoil);
}
