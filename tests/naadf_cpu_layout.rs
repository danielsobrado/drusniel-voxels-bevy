#[cfg(feature = "naadf")]
mod naadf_cpu_layout {
    use bevy::prelude::*;
    use serde::Deserialize;
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

    #[derive(Debug, Deserialize)]
    struct NaadfFixture {
        name: String,
        #[serde(default)]
        fill: Option<String>,
        #[serde(default)]
        occupied: Vec<(Vec<u32>, String)>,
        #[serde(default)]
        occupied_rule: Option<String>,
        #[serde(default)]
        empty_rule: Option<String>,
        rays: Vec<NaadfFixtureRay>,
    }

    #[derive(Debug, Deserialize)]
    struct NaadfFixtureRay {
        origin: Vec<f32>,
        dir: Vec<f32>,
        max_distance: f32,
        hit: Option<Vec<u32>>,
    }

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

    #[test]
    fn golden_fixture_rays_match_expected_hits() {
        for (path, contents) in naadf_fixture_files() {
            let fixture: NaadfFixture = ron::de::from_str(contents)
                .unwrap_or_else(|err| panic!("failed to parse {path}: {err}"));
            let chunk = chunk_from_fixture(&fixture);
            let backend =
                NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);

            for ray in &fixture.rays {
                let hit = backend.trace(
                    vec3_from_fixture(&ray.origin),
                    vec3_from_fixture(&ray.dir),
                    ray.max_distance,
                    VoxelRayPurpose::Debug,
                );
                let actual = hit.map(|hit| hit.local);
                let expected = ray.hit.as_deref().map(uvec3_from_fixture);
                assert_eq!(
                    actual, expected,
                    "fixture {} in {path} expected {expected:?}, got {actual:?}",
                    fixture.name
                );
            }
        }
    }

    fn naadf_fixture_files() -> [(&'static str, &'static str); 10] {
        [
            (
                "empty_chunk.ron",
                include_str!("fixtures/naadf/empty_chunk.ron"),
            ),
            (
                "full_chunk.ron",
                include_str!("fixtures/naadf/full_chunk.ron"),
            ),
            (
                "single_voxel.ron",
                include_str!("fixtures/naadf/single_voxel.ron"),
            ),
            ("wall_x.ron", include_str!("fixtures/naadf/wall_x.ron")),
            ("wall_y.ron", include_str!("fixtures/naadf/wall_y.ron")),
            ("wall_z.ron", include_str!("fixtures/naadf/wall_z.ron")),
            (
                "staircase.ron",
                include_str!("fixtures/naadf/staircase.ron"),
            ),
            ("tunnel.ron", include_str!("fixtures/naadf/tunnel.ron")),
            (
                "chunk_boundary.ron",
                include_str!("fixtures/naadf/chunk_boundary.ron"),
            ),
            (
                "bedrock_floor.ron",
                include_str!("fixtures/naadf/bedrock_floor.ron"),
            ),
        ]
    }

    fn chunk_from_fixture(fixture: &NaadfFixture) -> Chunk {
        let mut chunk = Chunk::new(IVec3::ZERO);
        if let Some(fill) = fixture.fill.as_deref() {
            let voxel = voxel_from_name(fill);
            for z in 0..16 {
                for y in 0..16 {
                    for x in 0..16 {
                        chunk.set(UVec3::new(x, y, z), voxel);
                    }
                }
            }
        }
        if let Some(empty_rule) = fixture.empty_rule.as_deref() {
            apply_rule(&mut chunk, empty_rule, VoxelType::Air);
        }
        if let Some(occupied_rule) = fixture.occupied_rule.as_deref() {
            apply_rule(&mut chunk, occupied_rule, VoxelType::Rock);
        }
        for (local, voxel) in &fixture.occupied {
            chunk.set(uvec3_from_fixture(local), voxel_from_name(voxel));
        }
        chunk
    }

    fn apply_rule(chunk: &mut Chunk, rule: &str, voxel: VoxelType) {
        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    if rule_matches(rule, x, y, z) {
                        chunk.set(UVec3::new(x, y, z), voxel);
                    }
                }
            }
        }
    }

    fn rule_matches(rule: &str, x: u32, y: u32, z: u32) -> bool {
        match rule {
            "x == 8" => x == 8,
            "y == 8" => y == 8,
            "z == 8" => z == 8,
            "x == y && z == 4" => x == y && z == 4,
            "y == 8 && z == 8" => y == 8 && z == 8,
            "y == 0" => y == 0,
            other => panic!("unsupported NAADF fixture rule: {other}"),
        }
    }

    fn voxel_from_name(name: &str) -> VoxelType {
        match name {
            "air" => VoxelType::Air,
            "rock" => VoxelType::Rock,
            "bedrock" => VoxelType::Bedrock,
            "water" => VoxelType::Water,
            other => panic!("unsupported fixture voxel type: {other}"),
        }
    }

    fn vec3_from_fixture(value: &[f32]) -> Vec3 {
        assert_eq!(value.len(), 3, "fixture vector must have exactly 3 values");
        Vec3::new(value[0], value[1], value[2])
    }

    fn uvec3_from_fixture(value: &[u32]) -> UVec3 {
        assert_eq!(value.len(), 3, "fixture vector must have exactly 3 values");
        UVec3::new(value[0], value[1], value[2])
    }
}

#[cfg(not(feature = "naadf"))]
#[test]
fn naadf_cpu_layout_tests_are_feature_gated() {
    assert!(true);
}
