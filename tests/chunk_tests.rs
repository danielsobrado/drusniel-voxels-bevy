//! Tests for Chunk and ChunkData functionality.

use bevy::math::{IVec3, UVec3};
use voxel_builder::constants::{CHUNK_SIZE, CHUNK_VOLUME};
use voxel_builder::voxel::chunk::{Chunk, ChunkData, LodLevel};
use voxel_builder::voxel::types::VoxelType;

#[test]
fn new_chunk_is_all_air() {
    let chunk = Chunk::new(IVec3::ZERO);

    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                assert_eq!(
                    chunk.get(UVec3::new(x as u32, y as u32, z as u32)),
                    VoxelType::Air
                );
            }
        }
    }
}

#[test]
fn new_chunk_is_dirty() {
    let chunk = Chunk::new(IVec3::ZERO);
    assert!(chunk.is_dirty());
}

#[test]
fn chunk_stores_position() {
    let pos = IVec3::new(5, -3, 10);
    let chunk = Chunk::new(pos);
    assert_eq!(chunk.position(), pos);
}

#[test]
fn set_and_get_voxel() {
    let mut chunk = Chunk::new(IVec3::ZERO);

    let pos = UVec3::new(5, 10, 3);
    chunk.set(pos, VoxelType::Rock);

    assert_eq!(chunk.get(pos), VoxelType::Rock);
}

#[test]
fn set_marks_chunk_dirty() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    chunk.clear_dirty();
    assert!(!chunk.is_dirty());

    chunk.set(UVec3::new(0, 0, 0), VoxelType::Rock);
    assert!(chunk.is_dirty());
}

#[test]
fn setting_same_voxel_does_not_mark_dirty() {
    let mut chunk = Chunk::new(IVec3::ZERO);

    // Chunk starts as all Air
    chunk.clear_dirty();
    chunk.set(UVec3::new(0, 0, 0), VoxelType::Air);

    assert!(!chunk.is_dirty(), "Setting same voxel should not mark dirty");
}

#[test]
fn clear_dirty_works() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    assert!(chunk.is_dirty());

    chunk.clear_dirty();
    assert!(!chunk.is_dirty());
}

#[test]
fn mark_dirty_works() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    chunk.clear_dirty();
    chunk.mark_dirty();
    assert!(chunk.is_dirty());
}

#[test]
fn corner_voxels_accessible() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    let max = (CHUNK_SIZE - 1) as u32;

    let corners = [
        UVec3::new(0, 0, 0),
        UVec3::new(max, 0, 0),
        UVec3::new(0, max, 0),
        UVec3::new(0, 0, max),
        UVec3::new(max, max, 0),
        UVec3::new(max, 0, max),
        UVec3::new(0, max, max),
        UVec3::new(max, max, max),
    ];

    for (i, corner) in corners.iter().enumerate() {
        let voxel = VoxelType::Rock;
        chunk.set(*corner, voxel);
        assert_eq!(chunk.get(*corner), voxel, "Corner {} failed", i);
    }
}

#[test]
fn default_lod_is_lod0() {
    let chunk = Chunk::new(IVec3::ZERO);
    assert_eq!(chunk.lod_level(), LodLevel::Lod0);
}

#[test]
fn set_lod_level_returns_true_on_change() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    chunk.clear_dirty();

    let changed = chunk.set_lod_level(LodLevel::Lod1);
    assert!(changed);
    assert!(chunk.is_dirty());
    assert_eq!(chunk.lod_level(), LodLevel::Lod1);
}

#[test]
fn set_lod_level_returns_false_when_same() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    chunk.clear_dirty();

    let changed = chunk.set_lod_level(LodLevel::Lod0);
    assert!(!changed);
    assert!(!chunk.is_dirty());
}

#[test]
fn lod_level_comparison() {
    assert!(LodLevel::Culled.is_lower_detail_than(LodLevel::Lod1));
    assert!(LodLevel::Lod1.is_lower_detail_than(LodLevel::Lod0));
    assert!(LodLevel::Lod0.is_higher_detail_than(LodLevel::Lod1));
    assert!(LodLevel::Lod1.is_higher_detail_than(LodLevel::Culled));
}

#[test]
fn lod_detail_values() {
    assert_eq!(LodLevel::Culled.detail_value(), 0);
    assert_eq!(LodLevel::Lod3.detail_value(), 1);
    assert_eq!(LodLevel::Lod2.detail_value(), 2);
    assert_eq!(LodLevel::Lod1.detail_value(), 3);
    assert_eq!(LodLevel::Lod0.detail_value(), 4);
}

#[test]
fn chunk_to_data_and_back() {
    let mut original = Chunk::new(IVec3::new(1, 2, 3));

    // Set some voxels
    original.set(UVec3::new(0, 0, 0), VoxelType::Rock);
    original.set(UVec3::new(5, 5, 5), VoxelType::Water);
    original.set(UVec3::new(15, 15, 15), VoxelType::Sand);

    // Convert to data
    let data = original.to_data();

    // Verify data
    assert_eq!(data.position, IVec3::new(1, 2, 3));
    assert_eq!(data.voxels.len(), CHUNK_VOLUME);

    // Convert back
    let restored = Chunk::from_data(data);

    // Verify restoration
    assert_eq!(restored.position(), IVec3::new(1, 2, 3));
    assert_eq!(restored.get(UVec3::new(0, 0, 0)), VoxelType::Rock);
    assert_eq!(restored.get(UVec3::new(5, 5, 5)), VoxelType::Water);
    assert_eq!(restored.get(UVec3::new(15, 15, 15)), VoxelType::Sand);
    assert!(restored.is_dirty(), "Restored chunk should be dirty");
}

#[test]
fn chunk_data_serializable() {
    let data = ChunkData {
        voxels: vec![VoxelType::Air; CHUNK_VOLUME],
        position: IVec3::new(10, 20, 30),
    };

    // Serialize with bincode
    let bytes = bincode::serialize(&data).expect("serialization should work");

    // Deserialize
    let restored: ChunkData = bincode::deserialize(&bytes).expect("deserialization should work");

    assert_eq!(restored.position, data.position);
    assert_eq!(restored.voxels.len(), data.voxels.len());
}

#[test]
fn mesh_entity_management() {
    use bevy::ecs::entity::Entity;

    let mut chunk = Chunk::new(IVec3::ZERO);

    assert!(chunk.mesh_entity().is_none());
    assert!(chunk.water_mesh_entity().is_none());

    // Create fake entities for testing
    let entity = Entity::from_bits(42);
    let water_entity = Entity::from_bits(43);

    chunk.set_mesh_entity(entity);
    chunk.set_water_mesh_entity(water_entity);

    assert_eq!(chunk.mesh_entity(), Some(entity));
    assert_eq!(chunk.water_mesh_entity(), Some(water_entity));

    chunk.clear_mesh_entity();
    chunk.clear_water_mesh_entity();

    assert!(chunk.mesh_entity().is_none());
    assert!(chunk.water_mesh_entity().is_none());
}
