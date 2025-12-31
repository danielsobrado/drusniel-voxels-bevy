//! Tests for VoxelWorld coordinate conversions.

use bevy::math::{IVec3, UVec3};
use rstest::rstest;
use voxel_builder::constants::CHUNK_SIZE_I32;
use voxel_builder::voxel::world::VoxelWorld;

#[rstest]
#[case(IVec3::new(0, 0, 0), IVec3::new(0, 0, 0))]
#[case(IVec3::new(15, 15, 15), IVec3::new(0, 0, 0))]
#[case(IVec3::new(16, 0, 0), IVec3::new(1, 0, 0))]
#[case(IVec3::new(-1, 0, 0), IVec3::new(-1, 0, 0))]
#[case(IVec3::new(0, -16, 31), IVec3::new(0, -1, 1))]
fn world_to_chunk_maps_boundaries(#[case] world_pos: IVec3, #[case] expected_chunk: IVec3) {
    assert_eq!(VoxelWorld::world_to_chunk(world_pos), expected_chunk);
}

#[rstest]
#[case(IVec3::new(0, 0, 0), UVec3::new(0, 0, 0))]
#[case(IVec3::new(15, 15, 15), UVec3::new(15, 15, 15))]
#[case(IVec3::new(16, 0, 0), UVec3::new(0, 0, 0))]
#[case(IVec3::new(-1, -1, -1), UVec3::new((CHUNK_SIZE_I32 - 1) as u32, (CHUNK_SIZE_I32 - 1) as u32, (CHUNK_SIZE_I32 - 1) as u32))]
fn world_to_local_wraps_coordinates(#[case] world_pos: IVec3, #[case] expected_local: UVec3) {
    assert_eq!(VoxelWorld::world_to_local(world_pos), expected_local);
}

#[rstest]
#[case(IVec3::new(0, 0, 0))]
#[case(IVec3::new(2, -3, 4))]
#[case(IVec3::new(-1, 1, -1))]
fn chunk_to_world_and_back_round_trip(#[case] chunk_pos: IVec3) {
    let world_origin = VoxelWorld::chunk_to_world(chunk_pos);
    assert_eq!(VoxelWorld::world_to_chunk(world_origin), chunk_pos);
}
