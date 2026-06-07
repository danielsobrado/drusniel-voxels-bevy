use bevy::prelude::*;

use crate::rendering::naadf::gpu_buffers::{
    NAADF_BLOCK_RECORD_BYTES, NAADF_MATERIAL_RECORD_BYTES, NAADF_VOXEL_RECORD_BYTES,
};
use crate::rendering::naadf::layout::{
    MIP_LEVEL_COUNT, NaadfMipBoundsRecord, NaadfPayloadRecord, NaadfTraversalRecord,
    mip_cell_index, mip_level_axis,
};
use crate::rendering::voxel_ray_backend::{VoxelRayHit, VoxelRayPurpose};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct NaadfGpuRayInputRecord {
    pub origin_max_distance: [f32; 4],
    pub direction_purpose: [f32; 4],
    pub chunk_pos: [i32; 4],
    pub chunk_node: u32,
    pub voxel_base_record: u32,
    pub material_base_record: u32,
    pub max_steps: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct NaadfGpuRayOutputRecord {
    pub hit_distance_material_steps: [u32; 4],
    pub world_voxel: [i32; 4],
    pub local_voxel: [u32; 4],
    pub normal: [f32; 4],
}

#[derive(Clone, Debug, PartialEq)]
pub struct NaadfGpuRayComparison {
    pub ray_index: usize,
    pub hit_matches: bool,
    pub distance_delta: f32,
    pub material_matches: bool,
    pub world_voxel_matches: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfMipParityFailure {
    pub level: u32,
    pub local: UVec3,
    pub field: &'static str,
    pub expected: u32,
    pub actual: u32,
}

impl NaadfGpuRayInputRecord {
    pub fn new(
        origin: Vec3,
        direction: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
        chunk_pos: IVec3,
        chunk_node: u32,
        slot: u32,
        max_steps: u32,
    ) -> Self {
        let base_record = slot * crate::constants::CHUNK_VOLUME as u32;
        Self {
            origin_max_distance: [origin.x, origin.y, origin.z, max_distance],
            direction_purpose: [direction.x, direction.y, direction.z, purpose as u32 as f32],
            chunk_pos: [chunk_pos.x, chunk_pos.y, chunk_pos.z, 0],
            chunk_node,
            voxel_base_record: base_record,
            material_base_record: base_record,
            max_steps,
        }
    }

    pub fn estimated_record_bytes() -> u32 {
        std::mem::size_of::<Self>() as u32
    }

    pub fn estimated_chunk_data_bytes() -> u32 {
        crate::constants::CHUNK_VOLUME as u32
            * (NAADF_VOXEL_RECORD_BYTES as u32 + NAADF_MATERIAL_RECORD_BYTES as u32)
            + crate::rendering::naadf::layout::BLOCKS_PER_CHUNK * NAADF_BLOCK_RECORD_BYTES as u32
    }
}

impl NaadfGpuRayOutputRecord {
    pub fn miss(steps: u32) -> Self {
        Self {
            hit_distance_material_steps: [0, 0.0f32.to_bits(), 0, steps],
            ..default()
        }
    }

    pub fn hit(
        distance: f32,
        material_id: u32,
        steps: u32,
        world_voxel: IVec3,
        local_voxel: UVec3,
        normal: Vec3,
    ) -> Self {
        Self {
            hit_distance_material_steps: [1, distance.to_bits(), material_id, steps],
            world_voxel: [world_voxel.x, world_voxel.y, world_voxel.z, 0],
            local_voxel: [local_voxel.x, local_voxel.y, local_voxel.z, 0],
            normal: [normal.x, normal.y, normal.z, 0.0],
        }
    }

    pub fn hit_flag(self) -> bool {
        self.hit_distance_material_steps[0] != 0
    }

    pub fn distance(self) -> f32 {
        f32::from_bits(self.hit_distance_material_steps[1])
    }

    pub fn material_id(self) -> u32 {
        self.hit_distance_material_steps[2]
    }

    pub fn steps(self) -> u32 {
        self.hit_distance_material_steps[3]
    }

    pub fn world_voxel(self) -> IVec3 {
        IVec3::new(
            self.world_voxel[0],
            self.world_voxel[1],
            self.world_voxel[2],
        )
    }
}

pub fn compare_gpu_ray_outputs_to_cpu(
    gpu_outputs: &[NaadfGpuRayOutputRecord],
    cpu_hits: &[Option<VoxelRayHit>],
    distance_tolerance: f32,
) -> Vec<NaadfGpuRayComparison> {
    gpu_outputs
        .iter()
        .copied()
        .zip(cpu_hits.iter())
        .enumerate()
        .map(|(ray_index, (gpu, cpu))| compare_one(ray_index, gpu, cpu, distance_tolerance))
        .collect()
}

pub fn compare_mip_records_to_cpu(
    expected_traversal: &[NaadfTraversalRecord],
    expected_payload: &[NaadfPayloadRecord],
    expected_bounds: &[NaadfMipBoundsRecord],
    actual_traversal: &[u32],
    actual_payload: &[u32],
    actual_bounds: &[u32],
) -> Vec<NaadfMipParityFailure> {
    let mut failures = Vec::new();
    for level in 0..MIP_LEVEL_COUNT {
        let axis = mip_level_axis(level);
        for z in 0..axis {
            for y in 0..axis {
                for x in 0..axis {
                    let local = UVec3::new(x, y, z);
                    let index = mip_cell_index(level, local);
                    push_mip_failure(
                        &mut failures,
                        level,
                        local,
                        "traversal",
                        expected_traversal[index].0,
                        actual_traversal[index],
                    );
                    push_mip_failure(
                        &mut failures,
                        level,
                        local,
                        "payload",
                        expected_payload[index].0,
                        actual_payload[index],
                    );
                    push_mip_failure(
                        &mut failures,
                        level,
                        local,
                        "bounds",
                        expected_bounds[index].0,
                        actual_bounds[index],
                    );
                }
            }
        }
    }
    failures
}

fn push_mip_failure(
    failures: &mut Vec<NaadfMipParityFailure>,
    level: u32,
    local: UVec3,
    field: &'static str,
    expected: u32,
    actual: u32,
) {
    if expected != actual {
        failures.push(NaadfMipParityFailure {
            level,
            local,
            field,
            expected,
            actual,
        });
    }
}

fn compare_one(
    ray_index: usize,
    gpu: NaadfGpuRayOutputRecord,
    cpu: &Option<VoxelRayHit>,
    distance_tolerance: f32,
) -> NaadfGpuRayComparison {
    let hit_matches = gpu.hit_flag() == cpu.is_some();
    let mut distance_delta = 0.0;
    let mut material_matches = hit_matches;
    let mut world_voxel_matches = hit_matches;

    if let Some(cpu_hit) = cpu {
        distance_delta = (gpu.distance() - cpu_hit.distance).abs();
        material_matches = gpu.material_id() == cpu_hit.material_id as u32;
        world_voxel_matches = gpu.world_voxel() == cpu_hit.world_voxel;
    }

    NaadfGpuRayComparison {
        ray_index,
        hit_matches: hit_matches && distance_delta <= distance_tolerance,
        distance_delta,
        material_matches,
        world_voxel_matches,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::cpu_builder::{
        NaadfBuildOptions, build_mip_pyramid_from_chunk, build_naadf_chunk,
        compute_directional_bounds, material_id_for_voxel, propagate_block_skip_in_chunk,
        propagate_voxel_skip_in_block,
    };
    use crate::rendering::naadf::gpu_buffers::{
        NAADF_PACKED_BLOCK_WORDS, NAADF_PACKED_CHUNK_WORDS, pack_naadf_chunk_upload,
        pack_raw_voxel_record, pack_voxel_record,
    };
    use crate::rendering::naadf::layout::{
        BLOCKS_PER_CHUNK, DirectionalBounds, NaadfBlock, NaadfNodeState, PackedNaadfNode,
        VOXELS_PER_BLOCK, VOXELS_PER_BLOCK_AXIS, block_index_in_chunk, voxel_index_in_block,
        voxel_index_in_chunk,
    };
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    #[test]
    fn input_record_uses_slot_for_voxel_and_material_bases() {
        let record = NaadfGpuRayInputRecord::new(
            Vec3::new(1.0, 2.0, 3.0),
            Vec3::X,
            64.0,
            VoxelRayPurpose::Debug,
            IVec3::new(1, 0, -1),
            42,
            3,
            128,
        );

        assert_eq!(record.origin_max_distance, [1.0, 2.0, 3.0, 64.0]);
        assert_eq!(record.chunk_pos, [1, 0, -1, 0]);
        assert_eq!(record.chunk_node, 42);
        assert_eq!(
            record.voxel_base_record,
            3 * crate::constants::CHUNK_VOLUME as u32
        );
        assert_eq!(record.material_base_record, record.voxel_base_record);
        assert_eq!(record.max_steps, 128);
    }

    #[test]
    fn gpu_output_comparison_matches_cpu_hit_payload() {
        let gpu = NaadfGpuRayOutputRecord::hit(
            4.0,
            2,
            12,
            IVec3::new(4, 5, 6),
            UVec3::new(4, 5, 6),
            Vec3::NEG_X,
        );
        let cpu = VoxelRayHit {
            position: Vec3::new(4.0, 5.0, 6.0),
            normal: Vec3::NEG_X,
            distance: 4.02,
            material_id: 2,
            chunk: IVec3::ZERO,
            local: UVec3::new(4, 5, 6),
            world_voxel: IVec3::new(4, 5, 6),
            steps: 12,
        };

        let comparisons = compare_gpu_ray_outputs_to_cpu(&[gpu], &[Some(cpu)], 0.05);

        assert_eq!(comparisons.len(), 1);
        assert!(comparisons[0].hit_matches);
        assert!(comparisons[0].material_matches);
        assert!(comparisons[0].world_voxel_matches);
    }

    #[test]
    fn debug_trace_shader_imports_ray_trace_module() {
        let source = include_str!("../../../../assets/shaders/naadf/debug_trace_rays.wgsl");
        let shader = bevy_shader::Shader::from_wgsl(source, "shaders/naadf/debug_trace_rays.wgsl");

        assert!(shader.imports().any(|import| {
            matches!(
                import,
                bevy_shader::ShaderImport::AssetPath(path)
                    if path == "shaders/naadf/ray_trace.wgsl"
            )
        }));
        assert!(source.contains("@compute"));
        assert!(source.contains("debug_trace_rays"));
    }

    #[test]
    fn shader_mirror_records_match_cpu_upload_for_fixture_shapes() {
        let fixtures = [
            (empty_chunk(IVec3::ZERO), NaadfBuildOptions::default()),
            (
                full_chunk(IVec3::new(1, 0, 0), VoxelType::Rock),
                NaadfBuildOptions::default(),
            ),
            (
                wall_chunk(IVec3::new(0, 1, 0), 0, 8),
                NaadfBuildOptions::default(),
            ),
            (
                wall_chunk(IVec3::new(0, 0, 1), 1, 7),
                NaadfBuildOptions::default(),
            ),
            (
                sparse_chunk(IVec3::new(-1, 2, -3)),
                NaadfBuildOptions::default(),
            ),
            (
                water_column_chunk(IVec3::new(3, -2, 1)),
                NaadfBuildOptions {
                    water_is_opaque: true,
                },
            ),
        ];

        for (slot, (chunk, options)) in fixtures.iter().enumerate() {
            assert_shader_mirror_matches_cpu_upload(chunk, slot as u32, *options);
        }
    }

    #[test]
    fn shader_mirror_records_match_cpu_upload_for_deterministic_random_chunks() {
        for seed in 0..12u32 {
            let position = IVec3::new(seed as i32 - 6, (seed as i32 % 5) - 2, seed as i32 * 2 - 9);
            let chunk = deterministic_material_mix_chunk(position, 0x9e37_79b9 ^ seed);
            let options = NaadfBuildOptions {
                water_is_opaque: seed % 2 == 0,
            };

            assert_shader_mirror_matches_cpu_upload(&chunk, seed, options);
        }
    }

    #[test]
    fn mip_parity_helper_reports_level_local_and_field() {
        let chunk = sparse_chunk(IVec3::ZERO);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        let pyramid = build_mip_pyramid_from_chunk(&naadf);
        let mut actual_traversal = pyramid
            .traversal_records
            .iter()
            .map(|record| record.0)
            .collect::<Vec<_>>();
        let actual_payload = pyramid
            .payload_records
            .iter()
            .map(|record| record.0)
            .collect::<Vec<_>>();
        let actual_bounds = pyramid
            .bounds_records
            .iter()
            .map(|record| record.0)
            .collect::<Vec<_>>();
        let changed_index = mip_cell_index(1, UVec3::new(1, 0, 0));
        actual_traversal[changed_index] ^= 1;

        let failures = compare_mip_records_to_cpu(
            &pyramid.traversal_records,
            &pyramid.payload_records,
            &pyramid.bounds_records,
            &actual_traversal,
            &actual_payload,
            &actual_bounds,
        );

        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].level, 1);
        assert_eq!(failures[0].local, UVec3::new(1, 0, 0));
        assert_eq!(failures[0].field, "traversal");
    }

    struct MirroredGpuRecords {
        chunk_record: [u32; NAADF_PACKED_CHUNK_WORDS],
        block_records: Vec<[u32; NAADF_PACKED_BLOCK_WORDS]>,
        voxel_records: Vec<u32>,
        raw_voxel_records: Vec<u32>,
        material_records: Vec<u32>,
    }

    fn mirror_gpu_build_records(
        chunk: &Chunk,
        _slot: u32,
        options: NaadfBuildOptions,
    ) -> MirroredGpuRecords {
        let mut occupancy = [false; crate::constants::CHUNK_VOLUME];
        let mut materials = [0u16; crate::constants::CHUNK_VOLUME];
        let mut occupied_count = 0usize;
        let mut first_material = 0u16;
        let mut uniform_material = true;

        for (local, voxel) in chunk.iter() {
            let index = voxel_index_in_chunk(local);
            let material_id = material_id_for_voxel(voxel, options);
            let occupied = material_id != 0;
            occupancy[index] = occupied;
            materials[index] = material_id;
            if occupied {
                occupied_count += 1;
                if first_material == 0 {
                    first_material = material_id;
                } else if first_material != material_id {
                    uniform_material = false;
                }
            }
        }

        let chunk_node = if occupied_count == 0 {
            PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0)
        } else if occupied_count == crate::constants::CHUNK_VOLUME && uniform_material {
            PackedNaadfNode::new(NaadfNodeState::UniformFull, first_material as u32)
        } else {
            PackedNaadfNode::new(NaadfNodeState::Children, 0)
        };

        let mut blocks = vec![NaadfBlock::default(); BLOCKS_PER_CHUNK as usize];
        let mut voxel_records = vec![0u32; crate::constants::CHUNK_VOLUME];
        for block_z in 0..4 {
            for block_y in 0..4 {
                for block_x in 0..4 {
                    let block_coord = UVec3::new(block_x, block_y, block_z);
                    let block_index = block_index_in_chunk(block_coord);
                    let mut block = mirror_gpu_build_block(block_coord, &occupancy, &materials);
                    let voxel_skip = propagate_voxel_skip_in_block(block.occupancy_mask);
                    for z in 0..VOXELS_PER_BLOCK_AXIS {
                        for y in 0..VOXELS_PER_BLOCK_AXIS {
                            for x in 0..VOXELS_PER_BLOCK_AXIS {
                                let block_local = UVec3::new(x, y, z);
                                let chunk_local = block_coord * VOXELS_PER_BLOCK_AXIS + block_local;
                                let chunk_index = voxel_index_in_chunk(chunk_local);
                                let local_index = voxel_index_in_block(block_local);
                                voxel_records[chunk_index] = pack_voxel_record(
                                    occupancy[chunk_index],
                                    voxel_skip[local_index].0,
                                );
                            }
                        }
                    }
                    block.directional_skip_blocks = Default::default();
                    blocks[block_index] = block;
                }
            }
        }
        propagate_block_skip_in_chunk(&mut blocks);

        MirroredGpuRecords {
            chunk_record: [
                chunk_node.0,
                i32_to_u32_bits(chunk.position().x),
                i32_to_u32_bits(chunk.position().y),
                i32_to_u32_bits(chunk.position().z),
                BLOCKS_PER_CHUNK,
                crate::constants::CHUNK_VOLUME as u32,
                0,
                0,
            ],
            block_records: blocks.iter().map(mirror_pack_block_record).collect(),
            voxel_records,
            raw_voxel_records: occupancy
                .iter()
                .zip(materials.iter())
                .map(|(occupied, material_id)| pack_raw_voxel_record(*occupied, *material_id))
                .collect(),
            material_records: materials
                .iter()
                .map(|material_id| *material_id as u32)
                .collect(),
        }
    }

    fn assert_shader_mirror_matches_cpu_upload(
        chunk: &Chunk,
        slot: u32,
        options: NaadfBuildOptions,
    ) {
        let naadf = build_naadf_chunk(chunk, options);
        let cpu_upload = pack_naadf_chunk_upload(&naadf, slot);
        let shader_mirror = mirror_gpu_build_records(chunk, slot, options);

        assert_eq!(
            cpu_upload.chunk_record,
            shader_mirror.chunk_record,
            "chunk record mismatch for slot {slot} at {:?}",
            chunk.position()
        );
        assert_eq!(
            cpu_upload.block_records,
            shader_mirror.block_records,
            "block record mismatch for slot {slot} at {:?}",
            chunk.position()
        );
        assert_eq!(
            cpu_upload.voxel_records,
            shader_mirror.voxel_records,
            "voxel record mismatch for slot {slot} at {:?}",
            chunk.position()
        );
        assert_eq!(
            cpu_upload.raw_voxel_records,
            shader_mirror.raw_voxel_records,
            "raw voxel record mismatch for slot {slot} at {:?}",
            chunk.position()
        );
        assert_eq!(
            cpu_upload.material_records,
            shader_mirror.material_records,
            "material record mismatch for slot {slot} at {:?}",
            chunk.position()
        );
    }

    fn mirror_gpu_build_block(
        block_coord: UVec3,
        occupancy: &[bool; crate::constants::CHUNK_VOLUME],
        materials: &[u16; crate::constants::CHUNK_VOLUME],
    ) -> NaadfBlock {
        let mut block = NaadfBlock::default();
        let mut occupied_count = 0usize;
        let mut first_material = 0u16;
        let mut uniform_material = true;

        for z in 0..VOXELS_PER_BLOCK_AXIS {
            for y in 0..VOXELS_PER_BLOCK_AXIS {
                for x in 0..VOXELS_PER_BLOCK_AXIS {
                    let block_local = UVec3::new(x, y, z);
                    let chunk_local = block_coord * VOXELS_PER_BLOCK_AXIS + block_local;
                    let chunk_index = voxel_index_in_chunk(chunk_local);
                    let block_index = voxel_index_in_block(block_local);
                    block.material_ids[block_index] = materials[chunk_index];
                    if occupancy[chunk_index] {
                        block.occupancy_mask |= 1u64 << block_index;
                        occupied_count += 1;
                        if first_material == 0 {
                            first_material = materials[chunk_index];
                        } else if first_material != materials[chunk_index] {
                            uniform_material = false;
                        }
                    }
                }
            }
        }

        block.node = if occupied_count == 0 {
            PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0)
        } else if occupied_count == VOXELS_PER_BLOCK as usize && uniform_material {
            PackedNaadfNode::new(NaadfNodeState::UniformFull, first_material as u32)
        } else {
            PackedNaadfNode::new(NaadfNodeState::Children, 0)
        };
        block.bounds = compute_directional_bounds(block.occupancy_mask);
        block
    }

    fn mirror_pack_block_record(block: &NaadfBlock) -> [u32; NAADF_PACKED_BLOCK_WORDS] {
        [
            block.node.0,
            mirror_pack_bounds(block.bounds),
            (block.occupancy_mask & u32::MAX as u64) as u32,
            (block.occupancy_mask >> 32) as u32,
            block.bounds.neg_z as u32 | ((block.bounds.pos_z as u32) << 8),
            block.directional_skip_blocks.0 as u32,
            0,
            0,
        ]
    }

    fn mirror_pack_bounds(bounds: DirectionalBounds) -> u32 {
        bounds.neg_x as u32
            | ((bounds.pos_x as u32) << 8)
            | ((bounds.neg_y as u32) << 16)
            | ((bounds.pos_y as u32) << 24)
    }

    fn i32_to_u32_bits(value: i32) -> u32 {
        u32::from_ne_bytes(value.to_ne_bytes())
    }

    fn empty_chunk(position: IVec3) -> Chunk {
        Chunk::new(position)
    }

    fn full_chunk(position: IVec3, voxel: VoxelType) -> Chunk {
        let mut chunk = Chunk::new(position);
        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    chunk.set(UVec3::new(x, y, z), voxel);
                }
            }
        }
        chunk
    }

    fn wall_chunk(position: IVec3, axis: usize, value: u32) -> Chunk {
        let mut chunk = Chunk::new(position);
        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    let coord = [x, y, z];
                    if coord[axis] == value {
                        chunk.set(UVec3::new(x, y, z), VoxelType::Rock);
                    }
                }
            }
        }
        chunk
    }

    fn sparse_chunk(position: IVec3) -> Chunk {
        let mut chunk = Chunk::new(position);
        for local in [
            UVec3::new(1, 2, 3),
            UVec3::new(5, 8, 13),
            UVec3::new(15, 0, 7),
            UVec3::new(9, 9, 9),
        ] {
            chunk.set(local, VoxelType::Rock);
        }
        chunk
    }

    fn water_column_chunk(position: IVec3) -> Chunk {
        let mut chunk = Chunk::new(position);
        for y in 0..16 {
            chunk.set(UVec3::new(8, y, 8), VoxelType::Water);
        }
        chunk
    }

    fn deterministic_material_mix_chunk(position: IVec3, seed: u32) -> Chunk {
        let mut state = seed;
        let mut chunk = Chunk::new(position);
        let materials = [
            VoxelType::Rock,
            VoxelType::Sand,
            VoxelType::Clay,
            VoxelType::Wood,
            VoxelType::Water,
        ];

        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    if state & 0xff < 48 {
                        let material = materials[((state >> 8) as usize) % materials.len()];
                        chunk.set(UVec3::new(x, y, z), material);
                    }
                }
            }
        }

        chunk
    }
}
