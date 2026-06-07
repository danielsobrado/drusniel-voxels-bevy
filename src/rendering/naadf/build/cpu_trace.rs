use bevy::prelude::*;
use std::collections::HashMap;

use crate::constants::CHUNK_SIZE_I32;
use crate::rendering::naadf::cache::propagate_chunk_skips;
use crate::rendering::naadf::entities::NaadfEntityVolumeRegistry;
use crate::rendering::naadf::layout::{
    BOUND_OFFSET_NEG_X, BOUND_OFFSET_NEG_Y, BOUND_OFFSET_NEG_Z, BOUND_OFFSET_POS_X,
    BOUND_OFFSET_POS_Y, BOUND_OFFSET_POS_Z, CHUNK_BOUND_OFFSET_NEG_X, CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_NEG_Z, CHUNK_BOUND_OFFSET_POS_X, CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_POS_Z, NaadfChunk, NaadfNodeState, VOXELS_PER_BLOCK_AXIS,
    block_coord_for_voxel, block_index_in_chunk, chunk_world_origin,
};
use crate::rendering::voxel_ray_backend::{
    VoxelRayBackend, VoxelRayBackendStats, VoxelRayHit, VoxelRayPurpose,
};
use crate::voxel::world::VoxelWorld;

/// Hard cap on traversal iterations to bound worst-case runtime if bounds data
/// is wrong (a sound algorithm should never reach this).
const TRACE_STEP_LIMIT: u32 = 4096;
const TRACE_EPSILON: f32 = 1.0e-4;

#[derive(Default)]
pub struct NaadfCpuRayBackend {
    chunks: HashMap<IVec3, NaadfChunk>,
    entity_volumes: NaadfEntityVolumeRegistry,
    stats: VoxelRayBackendStats,
}

impl NaadfCpuRayBackend {
    pub fn new(chunks: impl IntoIterator<Item = NaadfChunk>) -> Self {
        let mut chunks = chunks
            .into_iter()
            .map(|chunk| (chunk.position, chunk))
            .collect::<HashMap<_, _>>();
        propagate_chunk_skips(&mut chunks);
        Self {
            stats: VoxelRayBackendStats {
                ready: true,
                chunk_count: chunks.len() as u32,
                ..default()
            },
            chunks,
            entity_volumes: NaadfEntityVolumeRegistry::default(),
        }
    }

    pub fn with_entity_volumes(
        chunks: impl IntoIterator<Item = NaadfChunk>,
        entity_volumes: NaadfEntityVolumeRegistry,
    ) -> Self {
        let mut backend = Self::new(chunks);
        backend.entity_volumes = entity_volumes;
        backend
    }

    pub fn trace_with_stats(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
    ) -> (Option<VoxelRayHit>, u32) {
        let _ = purpose;
        self.trace_with_skip(origin, dir, max_distance)
    }

    /// Skip-traversal that consumes the per-voxel and per-block directional
    /// skip distances built by `cpu_builder`. Mirrors the inner loop of
    /// `rayTracing.fxh::shootRay` from cg-tuwien/NAADF: at each step it picks
    /// the safe AABB at the deepest available LOD (chunk → block → voxel) and
    /// advances the ray to whichever face it exits first.
    pub fn trace_with_skip(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
    ) -> (Option<VoxelRayHit>, u32) {
        let (chunk_hit, chunk_steps) = self.trace_chunks_with_skip(origin, dir, max_distance);
        let entity_hit = self.entity_volumes.trace(origin, dir, max_distance);
        match (chunk_hit, entity_hit) {
            (Some(chunk_hit), Some(entity_hit)) if entity_hit.distance < chunk_hit.distance => {
                let steps = chunk_steps.saturating_add(entity_hit.steps);
                (Some(entity_hit), steps)
            }
            (Some(chunk_hit), _) => (Some(chunk_hit), chunk_steps),
            (None, Some(entity_hit)) => {
                let steps = chunk_steps.saturating_add(entity_hit.steps);
                (Some(entity_hit), steps)
            }
            (None, None) => (None, chunk_steps),
        }
    }

    fn trace_chunks_with_skip(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
    ) -> (Option<VoxelRayHit>, u32) {
        let Some(dir) = dir.try_normalize() else {
            return (None, 0);
        };
        if max_distance <= 0.0 {
            return (None, 0);
        }

        let inv_dir_abs = Vec3::new(
            reciprocal_or_infinity(dir.x.abs()),
            reciprocal_or_infinity(dir.y.abs()),
            reciprocal_or_infinity(dir.z.abs()),
        );
        let sign_pos = BVec3::new(dir.x >= 0.0, dir.y >= 0.0, dir.z >= 0.0);

        let mut traveled = 0.0f32;
        let mut steps = 0u32;
        let mut last_normal = Vec3::ZERO;

        while traveled <= max_distance {
            steps = steps.saturating_add(1);
            if steps >= TRACE_STEP_LIMIT {
                break;
            }

            let pos = origin + dir * traveled;
            let cell_pos = pos - last_normal * 0.5;
            let world_voxel = cell_pos.floor().as_ivec3();
            let chunk_pos = VoxelWorld::world_to_chunk(world_voxel);
            let local = VoxelWorld::world_to_local(world_voxel);
            let chunk = self.chunks.get(&chunk_pos);

            let safe_box = match chunk {
                None => SafeBox::for_chunk(chunk_pos),
                Some(chunk) => match chunk.node.state() {
                    NaadfNodeState::UniformEmpty => {
                        SafeBox::for_chunk_with_skip(chunk_pos, chunk.chunk_skip)
                    }
                    NaadfNodeState::UniformFull => {
                        return (
                            Some(make_hit(
                                chunk_pos,
                                local,
                                world_voxel,
                                origin + dir * traveled,
                                last_normal_or_initial(last_normal, dir),
                                traveled,
                                chunk.node.payload() as u16,
                                steps,
                            )),
                            steps,
                        );
                    }
                    NaadfNodeState::Children | NaadfNodeState::Reserved => {
                        let block_coord = block_coord_for_voxel(local);
                        let block = &chunk.blocks[block_index_in_chunk(block_coord)];
                        match block.node.state() {
                            NaadfNodeState::UniformEmpty => SafeBox::for_block_with_skip(
                                chunk_pos,
                                block_coord,
                                block.directional_skip_blocks,
                            ),
                            NaadfNodeState::UniformFull => {
                                return (
                                    Some(make_hit(
                                        chunk_pos,
                                        local,
                                        world_voxel,
                                        origin + dir * traveled,
                                        last_normal_or_initial(last_normal, dir),
                                        traveled,
                                        block.node.payload() as u16,
                                        steps,
                                    )),
                                    steps,
                                );
                            }
                            NaadfNodeState::Children | NaadfNodeState::Reserved => {
                                if chunk.is_occupied(local) {
                                    return (
                                        Some(make_hit(
                                            chunk_pos,
                                            local,
                                            world_voxel,
                                            origin + dir * traveled,
                                            last_normal_or_initial(last_normal, dir),
                                            traveled,
                                            chunk.material_id(local),
                                            steps,
                                        )),
                                        steps,
                                    );
                                }
                                SafeBox::for_voxel_with_skip(world_voxel, chunk, local)
                            }
                        }
                    }
                },
            };

            let (advance, axis) = safe_box.exit_t(pos, sign_pos, inv_dir_abs);
            traveled += advance.max(TRACE_EPSILON);
            last_normal = exit_normal(axis, sign_pos);
        }

        (None, steps)
    }
}

#[derive(Debug, Clone, Copy)]
struct SafeBox {
    min: IVec3,
    max: IVec3,
}

impl SafeBox {
    fn for_chunk(chunk_pos: IVec3) -> Self {
        let origin = chunk_world_origin(chunk_pos);
        Self {
            min: origin,
            max: origin + IVec3::splat(CHUNK_SIZE_I32),
        }
    }

    fn for_chunk_with_skip(
        chunk_pos: IVec3,
        skip: crate::rendering::naadf::layout::PackedDirectionalBounds5Bit,
    ) -> Self {
        let origin = chunk_world_origin(chunk_pos);
        let neg = IVec3::new(
            skip.get_at_offset(CHUNK_BOUND_OFFSET_NEG_X) as i32,
            skip.get_at_offset(CHUNK_BOUND_OFFSET_NEG_Y) as i32,
            skip.get_at_offset(CHUNK_BOUND_OFFSET_NEG_Z) as i32,
        );
        let pos = IVec3::new(
            skip.get_at_offset(CHUNK_BOUND_OFFSET_POS_X) as i32,
            skip.get_at_offset(CHUNK_BOUND_OFFSET_POS_Y) as i32,
            skip.get_at_offset(CHUNK_BOUND_OFFSET_POS_Z) as i32,
        );
        Self {
            min: origin - neg * CHUNK_SIZE_I32,
            max: origin + (IVec3::ONE + pos) * CHUNK_SIZE_I32,
        }
    }

    fn for_block_with_skip(
        chunk_pos: IVec3,
        block_coord: UVec3,
        skip: crate::rendering::naadf::layout::PackedDirectionalBounds2Bit,
    ) -> Self {
        let block_axis = VOXELS_PER_BLOCK_AXIS as i32;
        let block_origin = chunk_world_origin(chunk_pos)
            + IVec3::new(
                block_coord.x as i32 * block_axis,
                block_coord.y as i32 * block_axis,
                block_coord.z as i32 * block_axis,
            );
        let neg = IVec3::new(
            skip.get_at_offset(BOUND_OFFSET_NEG_X) as i32,
            skip.get_at_offset(BOUND_OFFSET_NEG_Y) as i32,
            skip.get_at_offset(BOUND_OFFSET_NEG_Z) as i32,
        );
        let pos = IVec3::new(
            skip.get_at_offset(BOUND_OFFSET_POS_X) as i32,
            skip.get_at_offset(BOUND_OFFSET_POS_Y) as i32,
            skip.get_at_offset(BOUND_OFFSET_POS_Z) as i32,
        );
        Self {
            min: block_origin - neg * block_axis,
            max: block_origin + (IVec3::ONE + pos) * block_axis,
        }
    }

    fn for_voxel_with_skip(world_voxel: IVec3, chunk: &NaadfChunk, local: UVec3) -> Self {
        let skip = chunk.voxel_skip[crate::rendering::naadf::layout::voxel_index_in_chunk(local)];
        let neg = IVec3::new(
            skip.get_at_offset(BOUND_OFFSET_NEG_X) as i32,
            skip.get_at_offset(BOUND_OFFSET_NEG_Y) as i32,
            skip.get_at_offset(BOUND_OFFSET_NEG_Z) as i32,
        );
        let pos = IVec3::new(
            skip.get_at_offset(BOUND_OFFSET_POS_X) as i32,
            skip.get_at_offset(BOUND_OFFSET_POS_Y) as i32,
            skip.get_at_offset(BOUND_OFFSET_POS_Z) as i32,
        );
        Self {
            min: world_voxel - neg,
            max: world_voxel + IVec3::ONE + pos,
        }
    }

    fn exit_t(self, pos: Vec3, sign_pos: BVec3, inv_dir_abs: Vec3) -> (f32, u32) {
        let mut t = Vec3::splat(f32::INFINITY);
        if inv_dir_abs.x.is_finite() {
            let exit = if sign_pos.x {
                self.max.x as f32
            } else {
                self.min.x as f32
            };
            let dist = if sign_pos.x {
                exit - pos.x
            } else {
                pos.x - exit
            };
            t.x = dist.max(0.0) * inv_dir_abs.x;
        }
        if inv_dir_abs.y.is_finite() {
            let exit = if sign_pos.y {
                self.max.y as f32
            } else {
                self.min.y as f32
            };
            let dist = if sign_pos.y {
                exit - pos.y
            } else {
                pos.y - exit
            };
            t.y = dist.max(0.0) * inv_dir_abs.y;
        }
        if inv_dir_abs.z.is_finite() {
            let exit = if sign_pos.z {
                self.max.z as f32
            } else {
                self.min.z as f32
            };
            let dist = if sign_pos.z {
                exit - pos.z
            } else {
                pos.z - exit
            };
            t.z = dist.max(0.0) * inv_dir_abs.z;
        }

        if t.x <= t.y && t.x <= t.z {
            (t.x, 0)
        } else if t.y <= t.z {
            (t.y, 1)
        } else {
            (t.z, 2)
        }
    }
}

fn exit_normal(axis: u32, sign_pos: BVec3) -> Vec3 {
    match axis {
        0 => Vec3::new(if sign_pos.x { -1.0 } else { 1.0 }, 0.0, 0.0),
        1 => Vec3::new(0.0, if sign_pos.y { -1.0 } else { 1.0 }, 0.0),
        _ => Vec3::new(0.0, 0.0, if sign_pos.z { -1.0 } else { 1.0 }),
    }
}

fn last_normal_or_initial(last_normal: Vec3, dir: Vec3) -> Vec3 {
    if last_normal == Vec3::ZERO {
        -dir
    } else {
        last_normal
    }
}

fn make_hit(
    chunk_pos: IVec3,
    local: UVec3,
    world_voxel: IVec3,
    position: Vec3,
    normal: Vec3,
    distance: f32,
    material_id: u16,
    steps: u32,
) -> VoxelRayHit {
    VoxelRayHit {
        chunk: chunk_pos,
        local,
        world_voxel,
        position,
        normal,
        distance,
        material_id,
        steps,
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

/// Reference Amanatides–Woo DDA used by the equivalence tests below. Kept
/// behind `cfg(test)` so production callers always use the skip traversal.
#[cfg(test)]
impl NaadfCpuRayBackend {
    pub(crate) fn trace_with_dda(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
    ) -> Option<VoxelRayHit> {
        self.trace_with_dda_stats(origin, dir, max_distance).0
    }

    pub(crate) fn trace_with_dda_stats(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
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
        let next_boundary = Vec3::new(
            if step.x > 0 {
                voxel.x as f32 + 1.0
            } else {
                voxel.x as f32
            },
            if step.y > 0 {
                voxel.y as f32 + 1.0
            } else {
                voxel.y as f32
            },
            if step.z > 0 {
                voxel.z as f32 + 1.0
            } else {
                voxel.z as f32
            },
        );
        let mut t_max = Vec3::new(
            (next_boundary.x - origin.x) * inv_dir.x,
            (next_boundary.y - origin.y) * inv_dir.y,
            (next_boundary.z - origin.z) * inv_dir.z,
        );
        let t_delta = Vec3::new(inv_dir.x.abs(), inv_dir.y.abs(), inv_dir.z.abs());
        let mut distance = 0.0f32;
        let mut normal = -dir;
        let mut steps = 0u32;

        while distance <= max_distance {
            steps = steps.saturating_add(1);
            let chunk_pos = VoxelWorld::world_to_chunk(voxel);
            let local = VoxelWorld::world_to_local(voxel);
            if let Some(chunk) = self.chunks.get(&chunk_pos) {
                if chunk.is_occupied(local) {
                    return (
                        Some(VoxelRayHit {
                            chunk: chunk_pos,
                            local,
                            world_voxel: voxel,
                            position: origin + dir * distance,
                            normal,
                            distance,
                            material_id: chunk.material_id(local),
                            steps,
                        }),
                        steps,
                    );
                }
            }

            if t_max.x.is_finite() && t_max.x <= t_max.y && t_max.x <= t_max.z {
                voxel.x += step.x;
                distance = t_max.x;
                t_max.x += t_delta.x;
                normal = Vec3::new(-(step.x as f32), 0.0, 0.0);
            } else if t_max.y.is_finite() && t_max.y <= t_max.z {
                voxel.y += step.y;
                distance = t_max.y;
                t_max.y += t_delta.y;
                normal = Vec3::new(0.0, -(step.y as f32), 0.0);
            } else if t_max.z.is_finite() {
                voxel.z += step.z;
                distance = t_max.z;
                t_max.z += t_delta.z;
                normal = Vec3::new(0.0, 0.0, -(step.z as f32));
            } else {
                break;
            }
            if steps >= TRACE_STEP_LIMIT {
                break;
            }
        }

        (None, steps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
    use crate::rendering::naadf::entities::{NaadfEntityVolumeRegistry, NaadfEntityVoxelVolume};
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;
    use rand::SeedableRng;
    use rand::rngs::StdRng;
    use rand::{Rng, RngCore};

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

    #[test]
    fn cpu_ray_backend_returns_dynamic_entity_hit_when_closer_than_terrain() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(8, 0, 0), VoxelType::Rock);

        let entity = Entity::from_raw_u32(12).unwrap();
        let transform = GlobalTransform::from(Transform::from_xyz(4.0, 0.0, 0.0));
        let volume = NaadfEntityVoxelVolume::new(UVec3::ONE, Vec3::ONE, vec![7]).unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();
        registry.sync([(entity, &transform, &volume)]);
        let backend = NaadfCpuRayBackend::with_entity_volumes(
            [build_naadf_chunk(&chunk, NaadfBuildOptions::default())],
            registry,
        );

        let hit = backend
            .trace(
                Vec3::new(0.0, 0.5, 0.5),
                Vec3::X,
                16.0,
                VoxelRayPurpose::Debug,
            )
            .unwrap();

        assert_eq!(hit.material_id, 7);
        assert_eq!(hit.local, UVec3::ZERO);
        assert!((hit.distance - 4.0).abs() <= 0.001);
    }

    #[test]
    fn cpu_ray_backend_keeps_nearer_terrain_hit_before_dynamic_entity() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(3, 0, 0), VoxelType::Rock);

        let entity = Entity::from_raw_u32(13).unwrap();
        let transform = GlobalTransform::from(Transform::from_xyz(8.0, 0.0, 0.0));
        let volume = NaadfEntityVoxelVolume::new(UVec3::ONE, Vec3::ONE, vec![7]).unwrap();
        let mut registry = NaadfEntityVolumeRegistry::default();
        registry.sync([(entity, &transform, &volume)]);
        let backend = NaadfCpuRayBackend::with_entity_volumes(
            [build_naadf_chunk(&chunk, NaadfBuildOptions::default())],
            registry,
        );

        let hit = backend
            .trace(
                Vec3::new(0.0, 0.5, 0.5),
                Vec3::X,
                16.0,
                VoxelRayPurpose::Debug,
            )
            .unwrap();

        assert_eq!(hit.world_voxel, IVec3::new(3, 0, 0));
    }

    fn random_unit_dir(rng: &mut StdRng) -> Vec3 {
        loop {
            let v = Vec3::new(
                rng.gen_range(-1.0..1.0),
                rng.gen_range(-1.0..1.0),
                rng.gen_range(-1.0..1.0),
            );
            let len_sq = v.length_squared();
            if (0.05..1.0).contains(&len_sq) {
                return v / len_sq.sqrt();
            }
        }
    }

    fn random_sparse_chunk(rng: &mut StdRng, occupancy: f32) -> Chunk {
        let mut chunk = Chunk::new(IVec3::ZERO);
        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    if rng.r#gen::<f32>() < occupancy {
                        chunk.set(UVec3::new(x, y, z), VoxelType::Rock);
                    }
                }
            }
        }
        chunk
    }

    /// Skip-traversal must produce the same hit voxel as the reference DDA on
    /// every ray. This is the equivalence bar the user asked for: NAADF skip
    /// is sound iff it never disagrees with single-cell stepping. Run a few
    /// distinct seeds and densities so a single lucky seed can't hide a bug.
    #[test]
    fn skip_traversal_matches_dda_on_random_sparse_worlds() {
        for (seed, occupancy) in [(0x5EEDu64, 0.05), (0x1337, 0.15), (0xC0FFEE, 0.30)] {
            let mut rng = StdRng::seed_from_u64(seed);
            let chunk = random_sparse_chunk(&mut rng, occupancy);
            let backend =
                NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);

            for ray_idx in 0..400 {
                let origin = Vec3::new(
                    rng.gen_range(0.0..16.0),
                    rng.gen_range(0.0..16.0),
                    rng.gen_range(0.0..16.0),
                );
                let dir = random_unit_dir(&mut rng);
                let max_distance = 32.0;

                let skip = backend.trace_with_skip(origin, dir, max_distance).0;
                let dda = backend.trace_with_dda(origin, dir, max_distance);

                match (skip, dda) {
                    (None, None) => {}
                    (Some(s), Some(d)) => {
                        assert_eq!(
                            s.world_voxel, d.world_voxel,
                            "seed={seed:#x} ray={ray_idx} origin={origin} dir={dir} \
                             skip hit {:?} but DDA hit {:?}",
                            s.world_voxel, d.world_voxel
                        );
                    }
                    (Some(s), None) => panic!(
                        "seed={seed:#x} ray={ray_idx} origin={origin} dir={dir}: skip hit \
                         {:?} but DDA missed",
                        s.world_voxel
                    ),
                    (None, Some(d)) => panic!(
                        "seed={seed:#x} ray={ray_idx} origin={origin} dir={dir}: skip missed \
                         but DDA hit {:?}",
                        d.world_voxel
                    ),
                }
            }
        }
    }

    /// Same as above but the ray origin sits *outside* the loaded chunk so the
    /// skip path must correctly step through "missing chunk = empty" before
    /// landing inside a populated chunk.
    #[test]
    fn skip_traversal_handles_rays_originating_outside_loaded_chunks() {
        let mut rng = StdRng::seed_from_u64(0xABCDEF);
        let chunk = random_sparse_chunk(&mut rng, 0.20);
        let backend =
            NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);

        for ray_idx in 0..200 {
            // Origin in chunk (-1, 0, 0) (not loaded), aimed at the loaded chunk.
            let origin = Vec3::new(
                rng.gen_range(-16.0..-1.0),
                rng.gen_range(0.0..16.0),
                rng.gen_range(0.0..16.0),
            );
            let dir =
                (Vec3::new(8.0, 8.0, 8.0) - origin + random_unit_dir(&mut rng) * 2.0).normalize();
            let max_distance = 64.0;

            let skip = backend.trace_with_skip(origin, dir, max_distance).0;
            let dda = backend.trace_with_dda(origin, dir, max_distance);

            assert_eq!(
                skip.map(|h| h.world_voxel),
                dda.map(|h| h.world_voxel),
                "ray={ray_idx} origin={origin} dir={dir}"
            );
        }
    }

    #[test]
    fn skip_traversal_uses_chunk_level_skip_across_empty_chunks() {
        let empty_a = Chunk::new(IVec3::ZERO);
        let empty_b = Chunk::new(IVec3::X);
        let mut occupied = Chunk::new(IVec3::new(2, 0, 0));
        occupied.set(UVec3::new(0, 4, 4), VoxelType::Rock);

        let backend = NaadfCpuRayBackend::new([
            build_naadf_chunk(&empty_a, NaadfBuildOptions::default()),
            build_naadf_chunk(&empty_b, NaadfBuildOptions::default()),
            build_naadf_chunk(&occupied, NaadfBuildOptions::default()),
        ]);

        let origin = Vec3::new(0.5, 4.5, 4.5);
        let dir = Vec3::X;
        let (skip_hit, skip_steps) = backend.trace_with_skip(origin, dir, 64.0);
        let (dda_hit, dda_steps) = backend.trace_with_dda_stats(origin, dir, 64.0);

        assert_eq!(
            skip_hit.map(|hit| hit.world_voxel),
            dda_hit.map(|hit| hit.world_voxel)
        );
        assert!(
            skip_steps < dda_steps,
            "chunk-level skip should reduce steps across loaded empty chunks: skip={skip_steps} dda={dda_steps}"
        );
    }

    /// Skip-traversal should be *faster* than DDA in step count on sparse
    /// worlds — that's the whole point. If it ever needed more steps than DDA,
    /// either bounds are wrong or the algorithm is regressing.
    #[test]
    fn skip_traversal_takes_no_more_steps_than_dda() {
        let mut rng = StdRng::seed_from_u64(0xFACE_FEED);
        let chunk = random_sparse_chunk(&mut rng, 0.05);
        let backend =
            NaadfCpuRayBackend::new([build_naadf_chunk(&chunk, NaadfBuildOptions::default())]);

        let mut skip_total = 0u64;
        let mut dda_total = 0u64;
        for _ in 0..200 {
            let origin = Vec3::new(
                rng.gen_range(0.0..16.0),
                rng.gen_range(0.0..16.0),
                rng.gen_range(0.0..16.0),
            );
            let dir = random_unit_dir(&mut rng);
            let (_, skip_steps) = backend.trace_with_skip(origin, dir, 32.0);
            let (_, dda_steps) = backend.trace_with_dda_stats(origin, dir, 32.0);
            skip_total += skip_steps as u64;
            dda_total += dda_steps as u64;
        }

        // In aggregate, skip should be substantially cheaper on a 5%-dense world.
        assert!(
            skip_total <= dda_total.max(1),
            "skip_total={skip_total} should not exceed dda_total={dda_total} \
             on sparse worlds — bounds may be wrong"
        );
        // Silence unused warnings if seeded RNG iterations don't all match.
        let _ = RngCore::next_u32(&mut rng);
    }
}
