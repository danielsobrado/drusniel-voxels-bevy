use bevy::prelude::*;

use crate::rendering::naadf::gpu_buffers::{NAADF_MATERIAL_RECORD_BYTES, NAADF_VOXEL_RECORD_BYTES};
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
        let source = include_str!("../../../assets/shaders/naadf/debug_trace_rays.wgsl");
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
}
