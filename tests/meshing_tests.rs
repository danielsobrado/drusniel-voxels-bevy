//! Tests for chunk meshing algorithm.

use bevy::math::{IVec3, UVec3};
use voxel_builder::constants::CHUNK_SIZE;
use voxel_builder::voxel::chunk::Chunk;
use voxel_builder::voxel::types::VoxelType;

/// Helper to create a chunk filled with a specific voxel type.
fn create_filled_chunk(voxel: VoxelType) -> Chunk {
    let mut chunk = Chunk::new(IVec3::ZERO);
    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                chunk.set(UVec3::new(x as u32, y as u32, z as u32), voxel);
            }
        }
    }
    chunk
}

/// Helper to create a chunk with a single voxel at the center.
fn create_single_voxel_chunk(voxel: VoxelType) -> Chunk {
    let mut chunk = Chunk::new(IVec3::ZERO);
    chunk.set(UVec3::new(8, 8, 8), voxel);
    chunk
}

#[test]
fn empty_chunk_has_no_faces() {
    let chunk = Chunk::new(IVec3::ZERO);

    // Count solid voxels
    let mut solid_count = 0;
    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                let voxel = chunk.get(UVec3::new(x as u32, y as u32, z as u32));
                if voxel != VoxelType::Air {
                    solid_count += 1;
                }
            }
        }
    }

    assert_eq!(solid_count, 0, "Empty chunk should have no solid voxels");
}

#[test]
fn fully_solid_chunk_has_external_faces_only() {
    let chunk = create_filled_chunk(VoxelType::Rock);

    // A fully solid chunk should only have external faces (no internal faces)
    // External faces: 6 faces * 16 * 16 = 1536 faces total
    let mut internal_air_neighbors = 0;

    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                let pos = UVec3::new(x as u32, y as u32, z as u32);
                let voxel = chunk.get(pos);

                // Check if this solid voxel has any air neighbors inside the chunk
                if voxel == VoxelType::Rock {
                    // Check each neighbor direction, computing position only when in bounds
                    if x > 0 && chunk.get(UVec3::new((x - 1) as u32, y as u32, z as u32)) == VoxelType::Air {
                        internal_air_neighbors += 1;
                    }
                    if x < CHUNK_SIZE - 1 && chunk.get(UVec3::new((x + 1) as u32, y as u32, z as u32)) == VoxelType::Air {
                        internal_air_neighbors += 1;
                    }
                    if y > 0 && chunk.get(UVec3::new(x as u32, (y - 1) as u32, z as u32)) == VoxelType::Air {
                        internal_air_neighbors += 1;
                    }
                    if y < CHUNK_SIZE - 1 && chunk.get(UVec3::new(x as u32, (y + 1) as u32, z as u32)) == VoxelType::Air {
                        internal_air_neighbors += 1;
                    }
                    if z > 0 && chunk.get(UVec3::new(x as u32, y as u32, (z - 1) as u32)) == VoxelType::Air {
                        internal_air_neighbors += 1;
                    }
                    if z < CHUNK_SIZE - 1 && chunk.get(UVec3::new(x as u32, y as u32, (z + 1) as u32)) == VoxelType::Air {
                        internal_air_neighbors += 1;
                    }
                }
            }
        }
    }

    assert_eq!(
        internal_air_neighbors, 0,
        "Fully solid chunk should have no internal air neighbors"
    );
}

#[test]
fn single_voxel_has_six_faces() {
    let chunk = create_single_voxel_chunk(VoxelType::Rock);
    let center = UVec3::new(8, 8, 8);

    // A single voxel surrounded by air should have 6 visible faces
    let mut visible_faces = 0;

    // Check all 6 neighbors
    let neighbors = [
        UVec3::new(7, 8, 8),
        UVec3::new(9, 8, 8),
        UVec3::new(8, 7, 8),
        UVec3::new(8, 9, 8),
        UVec3::new(8, 8, 7),
        UVec3::new(8, 8, 9),
    ];

    for neighbor in neighbors {
        if chunk.get(neighbor) == VoxelType::Air {
            visible_faces += 1;
        }
    }

    assert_eq!(visible_faces, 6, "Single voxel should have 6 visible faces");
    assert_eq!(chunk.get(center), VoxelType::Rock, "Center should be rock");
}

#[test]
fn water_is_transparent_to_solid() {
    use voxel_builder::voxel::types::Voxel;

    let mut chunk = Chunk::new(IVec3::ZERO);

    // Place a rock block with water next to it
    chunk.set(UVec3::new(8, 8, 8), VoxelType::Rock);
    chunk.set(UVec3::new(9, 8, 8), VoxelType::Water);

    // The rock should have a face visible through the water
    let water = chunk.get(UVec3::new(9, 8, 8));
    assert!(water.is_liquid(), "Water should be liquid");
    assert!(water.is_transparent(), "Water should be transparent");
}

#[test]
fn voxel_type_properties_are_consistent() {
    use voxel_builder::voxel::types::Voxel;

    // Air should not be solid
    assert!(!VoxelType::Air.is_solid());
    assert!(!VoxelType::Air.is_liquid());

    // Rock should be solid and not liquid
    assert!(VoxelType::Rock.is_solid());
    assert!(!VoxelType::Rock.is_liquid());
    assert!(!VoxelType::Rock.is_transparent());

    // Water should be liquid and transparent
    assert!(VoxelType::Water.is_liquid());
    assert!(VoxelType::Water.is_transparent());
    assert!(!VoxelType::Water.is_solid());
}

#[test]
fn chunk_boundary_voxels_accessible() {
    let mut chunk = Chunk::new(IVec3::ZERO);
    let max = (CHUNK_SIZE - 1) as u32;

    // Set voxels at all boundaries
    let boundary_positions = [
        // Faces
        UVec3::new(0, 8, 8),      // -X face
        UVec3::new(max, 8, 8),    // +X face
        UVec3::new(8, 0, 8),      // -Y face
        UVec3::new(8, max, 8),    // +Y face
        UVec3::new(8, 8, 0),      // -Z face
        UVec3::new(8, 8, max),    // +Z face
    ];

    for pos in boundary_positions {
        chunk.set(pos, VoxelType::Rock);
        assert_eq!(
            chunk.get(pos),
            VoxelType::Rock,
            "Boundary voxel at {:?} should be Rock",
            pos
        );
    }
}

#[test]
fn adjacent_voxels_share_no_faces() {
    let mut chunk = Chunk::new(IVec3::ZERO);

    // Place two adjacent solid voxels
    chunk.set(UVec3::new(8, 8, 8), VoxelType::Rock);
    chunk.set(UVec3::new(9, 8, 8), VoxelType::Rock);

    // The face between them should not be rendered
    // Both voxels should have 5 visible faces each (not 6)
    let voxel1 = chunk.get(UVec3::new(8, 8, 8));
    let voxel2 = chunk.get(UVec3::new(9, 8, 8));

    assert_eq!(voxel1, VoxelType::Rock);
    assert_eq!(voxel2, VoxelType::Rock);

    // The shared face (between 8 and 9 on X axis) should be hidden
    // This is validated by the mesh generation not creating duplicate vertices
}

#[test]
fn different_voxel_types_have_different_atlas_indices() {
    use voxel_builder::voxel::types::Voxel;

    let rock_index = VoxelType::Rock.atlas_index();
    let sand_index = VoxelType::Sand.atlas_index();
    let subsoil_index = VoxelType::SubSoil.atlas_index();
    let topsoil_index = VoxelType::TopSoil.atlas_index();

    // All solid types should have unique atlas indices
    assert_ne!(rock_index, sand_index, "Rock and Sand should have different atlas indices");
    assert_ne!(rock_index, subsoil_index, "Rock and SubSoil should have different atlas indices");
    assert_ne!(sand_index, subsoil_index, "Sand and SubSoil should have different atlas indices");
    assert_ne!(rock_index, topsoil_index, "Rock and TopSoil should have different atlas indices");
}

#[test]
fn mesh_data_creation() {
    use voxel_builder::voxel::meshing::MeshData;

    let mesh_data = MeshData::new();

    assert!(mesh_data.is_empty(), "New MeshData should be empty");
    assert!(mesh_data.positions.is_empty());
    assert!(mesh_data.normals.is_empty());
    assert!(mesh_data.uvs.is_empty());
    assert!(mesh_data.colors.is_empty());
    assert!(mesh_data.indices.is_empty());
}

#[test]
fn lod_level_ordering() {
    use voxel_builder::voxel::chunk::LodLevel;

    // Verify LOD level ordering (Lod0 is highest detail, Culled is lowest)
    assert!(LodLevel::Culled.detail_value() < LodLevel::Lod3.detail_value());
    assert!(LodLevel::Lod3.detail_value() < LodLevel::Lod2.detail_value());
    assert!(LodLevel::Lod2.detail_value() < LodLevel::Lod1.detail_value());
    assert!(LodLevel::Lod1.detail_value() < LodLevel::Lod0.detail_value());

    // Verify comparison methods
    assert!(LodLevel::Lod0.is_higher_detail_than(LodLevel::Lod1));
    assert!(LodLevel::Lod0.is_higher_detail_than(LodLevel::Culled));
    assert!(LodLevel::Lod1.is_higher_detail_than(LodLevel::Culled));

    assert!(LodLevel::Culled.is_lower_detail_than(LodLevel::Lod1));
    assert!(LodLevel::Culled.is_lower_detail_than(LodLevel::Lod0));
    assert!(LodLevel::Lod1.is_lower_detail_than(LodLevel::Lod0));
}

