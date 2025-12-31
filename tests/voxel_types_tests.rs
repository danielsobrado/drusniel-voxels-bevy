//! Tests for VoxelType enum and its trait implementations.

use voxel_builder::voxel::types::{VoxelType, Voxel};

#[test]
fn air_is_not_solid() {
    assert!(!VoxelType::Air.is_solid());
}

#[test]
fn water_is_not_solid() {
    assert!(!VoxelType::Water.is_solid());
}

#[test]
fn solid_blocks_are_solid() {
    let solid_types = [
        VoxelType::TopSoil,
        VoxelType::SubSoil,
        VoxelType::Rock,
        VoxelType::Bedrock,
        VoxelType::Sand,
        VoxelType::Clay,
        VoxelType::Wood,
        VoxelType::Leaves,
        VoxelType::DungeonWall,
        VoxelType::DungeonFloor,
    ];

    for voxel in solid_types {
        assert!(voxel.is_solid(), "{:?} should be solid", voxel);
    }
}

#[test]
fn transparent_types_identified_correctly() {
    // Transparent types
    assert!(VoxelType::Air.is_transparent());
    assert!(VoxelType::Water.is_transparent());
    assert!(VoxelType::Leaves.is_transparent());

    // Opaque types
    assert!(!VoxelType::TopSoil.is_transparent());
    assert!(!VoxelType::Rock.is_transparent());
    assert!(!VoxelType::Wood.is_transparent());
}

#[test]
fn only_water_is_liquid() {
    assert!(VoxelType::Water.is_liquid());

    let non_liquid_types = [
        VoxelType::Air,
        VoxelType::TopSoil,
        VoxelType::SubSoil,
        VoxelType::Rock,
        VoxelType::Bedrock,
        VoxelType::Sand,
        VoxelType::Clay,
        VoxelType::Wood,
        VoxelType::Leaves,
        VoxelType::DungeonWall,
        VoxelType::DungeonFloor,
    ];

    for voxel in non_liquid_types {
        assert!(!voxel.is_liquid(), "{:?} should not be liquid", voxel);
    }
}

#[test]
fn atlas_indices_are_unique_for_visible_types() {
    // Visible types should have distinct atlas indices
    // (Air uses 0 but is never rendered)
    let visible_types = [
        VoxelType::TopSoil,
        VoxelType::SubSoil,
        VoxelType::Rock,
        VoxelType::Bedrock,
        VoxelType::Sand,
        VoxelType::Clay,
        VoxelType::Water,
        VoxelType::Wood,
        VoxelType::Leaves,
        VoxelType::DungeonWall,
        VoxelType::DungeonFloor,
    ];

    let mut indices: Vec<u8> = visible_types.iter().map(|v| v.atlas_index()).collect();
    indices.sort();

    // Check for no consecutive duplicates after sorting
    for i in 1..indices.len() {
        assert_ne!(
            indices[i], indices[i - 1],
            "Duplicate atlas index {} found",
            indices[i]
        );
    }
}

#[test]
fn default_voxel_is_air() {
    assert_eq!(VoxelType::default(), VoxelType::Air);
}

#[test]
fn voxel_types_are_copy() {
    let a = VoxelType::Rock;
    let b = a; // Copy
    assert_eq!(a, b);
}

#[test]
fn voxel_types_are_hashable() {
    use std::collections::HashSet;

    let mut set = HashSet::new();
    set.insert(VoxelType::Rock);
    set.insert(VoxelType::Sand);
    set.insert(VoxelType::Rock); // Duplicate

    assert_eq!(set.len(), 2);
}
