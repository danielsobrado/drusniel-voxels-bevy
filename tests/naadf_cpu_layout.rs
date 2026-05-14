#[cfg(feature = "naadf")]
mod naadf_cpu_layout {
    use bevy::prelude::*;
    use voxel_builder::rendering::naadf::cpu_builder::{
        NaadfBuildOptions, build_naadf_chunk, compute_directional_bounds,
    };
    use voxel_builder::rendering::naadf::cpu_trace::NaadfCpuRayBackend;
    use voxel_builder::rendering::naadf::layout::{
        DirectionalBounds, NaadfNodeState, VOXELS_PER_BLOCK_AXIS, voxel_index_in_block,
        voxel_index_in_chunk,
    };
    use voxel_builder::rendering::voxel_ray_backend::{VoxelRayBackend, VoxelRayPurpose};
    use voxel_builder::voxel::chunk::Chunk;
    use voxel_builder::voxel::types::VoxelType;

    #[test]
    fn layout_constants_match_drusniel_chunks() {
        assert_eq!(VOXELS_PER_BLOCK_AXIS, 4);
        assert_eq!(voxel_index_in_chunk(UVec3::new(15, 15, 15)), 4095);
    }

    #[test]
    fn full_chunk_builds_uniform_full() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    chunk.set(UVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }

        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        assert_eq!(naadf.node.state(), NaadfNodeState::UniformFull);
    }

    #[test]
    fn mixed_chunk_builds_children_and_stable_materials() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(1, 2, 3), VoxelType::Rock);
        chunk.set(UVec3::new(4, 5, 6), VoxelType::Water);

        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        assert_eq!(naadf.node.state(), NaadfNodeState::Children);
        assert_eq!(
            naadf.material_id(UVec3::new(1, 2, 3)),
            VoxelType::Rock as u16
        );
        assert_eq!(naadf.material_id(UVec3::new(4, 5, 6)), 0);
    }

    #[test]
    fn directional_bounds_cover_empty_full_and_single_voxel() {
        assert_eq!(
            compute_directional_bounds(0),
            DirectionalBounds::empty_block()
        );
        assert_eq!(
            compute_directional_bounds(u64::MAX),
            DirectionalBounds::full_block()
        );
        let mask = 1u64 << voxel_index_in_block(UVec3::new(0, 0, 0));
        assert_eq!(
            compute_directional_bounds(mask),
            DirectionalBounds {
                neg_x: 0,
                pos_x: 3,
                neg_y: 0,
                pos_y: 3,
                neg_z: 0,
                pos_z: 3,
            }
        );
    }

    #[test]
    fn cpu_ray_crosses_chunk_boundary() {
        let mut chunk = Chunk::new(IVec3::new(1, 0, 0));
        chunk.set(UVec3::new(0, 8, 8), VoxelType::Rock);
        let backend =
            NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);

        let hit = backend.trace(
            Vec3::new(15.5, 8.5, 8.5),
            Vec3::X,
            8.0,
            VoxelRayPurpose::Debug,
        );

        assert_eq!(hit.map(|hit| hit.world_voxel), Some(IVec3::new(16, 8, 8)));
    }
}

#[cfg(not(feature = "naadf"))]
#[test]
fn naadf_cpu_layout_tests_are_feature_gated() {
    assert!(true);
}
