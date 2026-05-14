use bevy::prelude::*;
use std::collections::HashMap;

use crate::constants::CHUNK_SIZE_I32;
use crate::rendering::naadf::layout::{NaadfChunk, chunk_world_origin};
use crate::rendering::voxel_ray_backend::{
    VoxelRayBackend, VoxelRayBackendStats, VoxelRayHit, VoxelRayPurpose,
};
use crate::voxel::world::VoxelWorld;

#[derive(Default)]
pub struct NaadfCpuRayBackend {
    chunks: HashMap<IVec3, NaadfChunk>,
    stats: VoxelRayBackendStats,
}

impl NaadfCpuRayBackend {
    pub fn new(chunks: impl IntoIterator<Item = NaadfChunk>) -> Self {
        let chunks = chunks
            .into_iter()
            .map(|chunk| (chunk.position, chunk))
            .collect::<HashMap<_, _>>();
        Self {
            stats: VoxelRayBackendStats {
                ready: true,
                chunk_count: chunks.len() as u32,
                ..default()
            },
            chunks,
        }
    }

    pub fn trace_with_stats(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
    ) -> (Option<VoxelRayHit>, u32) {
        let Some(dir) = dir.try_normalize() else {
            return (None, 0);
        };
        if max_distance <= 0.0 {
            return (None, 0);
        }

        let mut voxel = origin.floor().as_ivec3();
        let step = IVec3::new(
            if dir.x >= 0.0 { 1 } else { -1 },
            if dir.y >= 0.0 { 1 } else { -1 },
            if dir.z >= 0.0 { 1 } else { -1 },
        );
        let inv_dir = Vec3::new(
            reciprocal_or_infinity(dir.x),
            reciprocal_or_infinity(dir.y),
            reciprocal_or_infinity(dir.z),
        );
        let mut t_max = Vec3::new(
            axis_t_max(origin.x, voxel.x, step.x, inv_dir.x),
            axis_t_max(origin.y, voxel.y, step.y, inv_dir.y),
            axis_t_max(origin.z, voxel.z, step.z, inv_dir.z),
        );
        let t_delta = Vec3::new(inv_dir.x.abs(), inv_dir.y.abs(), inv_dir.z.abs());
        let mut distance = 0.0f32;
        let mut normal = Vec3::ZERO;
        let mut steps = 0u32;

        while distance <= max_distance {
            steps = steps.saturating_add(1);
            if let Some(hit) = self.hit_voxel(origin, dir, voxel, distance, normal, steps) {
                let _ = purpose;
                return (Some(hit), steps);
            }

            if t_max.x <= t_max.y && t_max.x <= t_max.z {
                voxel.x += step.x;
                distance = t_max.x;
                t_max.x += t_delta.x;
                normal = Vec3::new(-(step.x as f32), 0.0, 0.0);
            } else if t_max.y <= t_max.z {
                voxel.y += step.y;
                distance = t_max.y;
                t_max.y += t_delta.y;
                normal = Vec3::new(0.0, -(step.y as f32), 0.0);
            } else {
                voxel.z += step.z;
                distance = t_max.z;
                t_max.z += t_delta.z;
                normal = Vec3::new(0.0, 0.0, -(step.z as f32));
            }
        }

        (None, steps)
    }

    fn hit_voxel(
        &self,
        origin: Vec3,
        dir: Vec3,
        world_voxel: IVec3,
        distance: f32,
        normal: Vec3,
        steps: u32,
    ) -> Option<VoxelRayHit> {
        let chunk_pos = VoxelWorld::world_to_chunk(world_voxel);
        let local = VoxelWorld::world_to_local(world_voxel);
        let chunk = self.chunks.get(&chunk_pos)?;
        if !chunk.is_occupied(local) {
            return None;
        }
        Some(VoxelRayHit {
            chunk: chunk_pos,
            local,
            world_voxel,
            position: origin + dir * distance,
            normal,
            distance,
            material_id: chunk.material_id(local),
            steps,
        })
    }
}

impl VoxelRayBackend for NaadfCpuRayBackend {
    fn name(&self) -> &'static str {
        "naadf_cpu"
    }

    fn trace(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
    ) -> Option<VoxelRayHit> {
        self.trace_with_stats(origin, dir, max_distance, purpose).0
    }

    fn is_ready(&self) -> bool {
        true
    }

    fn stats(&self) -> VoxelRayBackendStats {
        self.stats
    }
}

pub fn chunk_bounds(chunk: &NaadfChunk) -> (IVec3, IVec3) {
    let min = chunk_world_origin(chunk.position);
    (min, min + IVec3::splat(CHUNK_SIZE_I32 - 1))
}

fn reciprocal_or_infinity(value: f32) -> f32 {
    if value.abs() <= f32::EPSILON {
        f32::INFINITY
    } else {
        1.0 / value
    }
}

fn axis_t_max(origin_axis: f32, voxel_axis: i32, step_axis: i32, inv_dir_axis: f32) -> f32 {
    if inv_dir_axis.is_infinite() {
        return f32::INFINITY;
    }
    let boundary = if step_axis > 0 {
        voxel_axis as f32 + 1.0
    } else {
        voxel_axis as f32
    };
    (boundary - origin_axis) * inv_dir_axis
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    #[test]
    fn cpu_ray_hits_single_voxel() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(4, 4, 4), VoxelType::Rock);
        let backend =
            NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);
        let hit = backend.trace(
            Vec3::new(0.5, 4.5, 4.5),
            Vec3::X,
            16.0,
            VoxelRayPurpose::Debug,
        );
        assert_eq!(hit.map(|hit| hit.local), Some(UVec3::new(4, 4, 4)));
    }

    #[test]
    fn cpu_ray_misses_empty_chunk() {
        let chunk = Chunk::new(IVec3::ZERO);
        let backend =
            NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);
        assert!(
            backend
                .trace(Vec3::ZERO, Vec3::X, 16.0, VoxelRayPurpose::Debug)
                .is_none()
        );
    }
}
