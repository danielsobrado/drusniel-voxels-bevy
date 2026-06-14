use super::{LodTransitionSnapStats, terrain_meshing_voxel_at, terrain_meshing_voxel_in_chunk};
use crate::constants::{
    CHUNK_SIZE_I32, LOD0_GRID_VOLUME, LOD0_PADDED_SIZE, LOD0_STEP_SIZE, LOD1_GRID_VOLUME,
    LOD1_PADDED_SIZE, LOD1_STEP_SIZE, LOD2_GRID_VOLUME, LOD2_PADDED_SIZE, LOD2_STEP_SIZE,
    LOD3_GRID_VOLUME, LOD3_PADDED_SIZE, LOD3_STEP_SIZE, PADDED_CHUNK_SIZE_U32,
};
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec3, UVec3, Vec3, info};
use ndshape::{ConstShape, ConstShape3u32};
use std::sync::OnceLock;

// =============================================================================
// Surface Nets Smooth Meshing
// =============================================================================

/// Padded chunk shape for surface nets.
/// Surface Nets needs +1 padding on each side to sample neighboring voxels,
/// resulting in an 18x18x18 sample grid for a 16x16x16 chunk.
pub(super) type PaddedChunkShape =
    ConstShape3u32<PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE_U32>;

// =============================================================================
// LOD Shape Types - Compile-time grid shapes for different detail levels
// =============================================================================

// Note: LOD 0 (High Detail) uses PaddedChunkShape defined above (18x18x18 grid, step size 1)

/// LOD 1 (Low Detail): 10x10x10 grid, step size 2
/// Samples every 2nd voxel, reducing vertex count by ~75%
pub(super) type LodShape1 =
    ConstShape3u32<{ LOD1_PADDED_SIZE }, { LOD1_PADDED_SIZE }, { LOD1_PADDED_SIZE }>;

/// Samples every 4th voxel, reducing vertex count by ~94%
pub(super) type LodShape2 =
    ConstShape3u32<{ LOD2_PADDED_SIZE }, { LOD2_PADDED_SIZE }, { LOD2_PADDED_SIZE }>;

/// Samples every 8th voxel, reducing vertex count by ~98%
pub(super) type LodShape3 =
    ConstShape3u32<{ LOD3_PADDED_SIZE }, { LOD3_PADDED_SIZE }, { LOD3_PADDED_SIZE }>;

/// Configuration for LOD mesh generation
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LodMeshConfig {
    /// Voxel sampling interval (1 = every voxel, 2 = every other, etc.)
    pub step_size: u32,
    /// Size of the padded SDF grid
    pub padded_size: u32,
    /// Total volume of the SDF grid (padded_size^3)
    pub grid_volume: usize,
}

impl LodMeshConfig {
    /// High detail configuration: full resolution (step 1, 18x18x18)
    pub const HIGH: Self = Self {
        step_size: LOD0_STEP_SIZE,
        padded_size: LOD0_PADDED_SIZE,
        grid_volume: LOD0_GRID_VOLUME,
    };

    /// Low detail configuration: half resolution (step 2, 10x10x10)
    pub const LOD1: Self = Self {
        step_size: LOD1_STEP_SIZE,
        padded_size: LOD1_PADDED_SIZE,
        grid_volume: LOD1_GRID_VOLUME,
    };

    /// Very low detail configuration: quarter resolution (step 4, 6x6x6)
    pub const LOD2: Self = Self {
        step_size: LOD2_STEP_SIZE,
        padded_size: LOD2_PADDED_SIZE,
        grid_volume: LOD2_GRID_VOLUME,
    };

    /// Extreme low detail configuration: eighth resolution (step 8, 4x4x4)
    pub const LOD3: Self = Self {
        step_size: LOD3_STEP_SIZE,
        padded_size: LOD3_PADDED_SIZE,
        grid_volume: LOD3_GRID_VOLUME,
    };

    /// Get the appropriate config for a given LOD level
    pub fn from_lod_level(level: LodLevel) -> Self {
        match level {
            LodLevel::Lod0 => Self::HIGH,
            LodLevel::Lod1 => Self::LOD1,
            LodLevel::Lod2 => Self::LOD2,
            LodLevel::Lod3 => Self::LOD3,
            LodLevel::Culled => Self::LOD3, // Fallback
        }
    }
}

/// Sample voxel from world or chunk, returns true if solid OR water
/// Water is treated as solid for SDF purposes to prevent surface nets from generating
/// surfaces at solid-water boundaries (which would create visible seams with the blocky water mesh)
pub(super) fn sample_voxel_solid(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
) -> bool {
    let world_pos = chunk_origin + IVec3::new(px as i32 - 1, py as i32 - 1, pz as i32 - 1);

    let voxel = if px >= 1 && px <= 16 && py >= 1 && py <= 16 && pz >= 1 && pz <= 16 {
        terrain_meshing_voxel_in_chunk(chunk, world, UVec3::new(px - 1, py - 1, pz - 1))
    } else {
        terrain_meshing_voxel_at(world, world_pos)
    };

    // Treat water as solid for SDF so we don't generate surfaces at solid-water boundaries
    voxel.is_solid() || voxel.is_liquid()
}

/// Surface Nets can assign a vertical chunk-boundary cap to the all-air chunk
/// above or below terrain. Those chunks still need mesh/collider generation even
/// though their own voxel payload is empty.
pub(crate) fn empty_chunk_has_surface_nets_boundary_surface(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> bool {
    let origin = VoxelWorld::chunk_to_world(chunk_pos);

    let below_y = origin.y - 1;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if terrain_meshing_voxel_at(world, IVec3::new(origin.x + x, below_y, origin.z + z))
                .is_solid()
            {
                return true;
            }
        }
    }

    let above_y = origin.y + CHUNK_SIZE_I32;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if terrain_meshing_voxel_at(world, IVec3::new(origin.x + x, above_y, origin.z + z))
                .is_solid()
            {
                return true;
            }
        }
    }

    false
}

pub(crate) fn count_missing_in_bounds_boundary_neighbors(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> u32 {
    let mut missing = 0;
    let origin = VoxelWorld::chunk_to_world(chunk_pos);
    for z in -1..=CHUNK_SIZE_I32 {
        for y in -1..=CHUNK_SIZE_I32 {
            for x in -1..=CHUNK_SIZE_I32 {
                let on_halo = x == -1
                    || x == CHUNK_SIZE_I32
                    || y == -1
                    || y == CHUNK_SIZE_I32
                    || z == -1
                    || z == CHUNK_SIZE_I32;
                if !on_halo {
                    continue;
                }
                let pos = origin + IVec3::new(x, y, z);
                if world
                    .sample_voxel_for_terrain_meshing(pos)
                    .is_missing_chunk_inside_bounds()
                {
                    missing += 1;
                }
            }
        }
    }
    missing
}

pub(crate) fn neighbor_lod_for_face(
    neighbor_lods: &NeighborLods,
    face: ChunkFace,
) -> Option<LodLevel> {
    match face {
        ChunkFace::NegX => neighbor_lods.neg_x,
        ChunkFace::PosX => neighbor_lods.pos_x,
        ChunkFace::NegY => neighbor_lods.neg_y,
        ChunkFace::PosY => neighbor_lods.pos_y,
        ChunkFace::NegZ => neighbor_lods.neg_z,
        ChunkFace::PosZ => neighbor_lods.pos_z,
    }
}

pub(super) fn lod_transition_step_for_padded_size(
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    px: u32,
    py: u32,
    pz: u32,
    padded_size: u32,
) -> Option<i32> {
    let mut transition_step = my_lod.step_size();
    let mut has_transition = false;

    // Treat the two outermost padded planes on each chunk face as transition
    // cells whenever the neighbor has a different non-culled LOD. The Surface
    // Nets cell at an LOD junction straddles the shared boundary and uses both
    // outer planes as corners; both sides must evaluate the same effective
    // coarse field or the seam lights as a terrace even when it is watertight.
    // sits ~one step lower — and a see-through seam opens between them.
    for (face, on_boundary_band) in [
        (ChunkFace::NegX, px <= 1),
        (ChunkFace::PosX, px >= padded_size - 2),
        (ChunkFace::NegY, py <= 1),
        (ChunkFace::PosY, py >= padded_size - 2),
        (ChunkFace::NegZ, pz <= 1),
        (ChunkFace::PosZ, pz >= padded_size - 2),
    ] {
        if !on_boundary_band {
            continue;
        }

        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        if neighbor_lod != LodLevel::Culled && neighbor_lod != my_lod {
            has_transition = true;
            transition_step = transition_step.max(neighbor_lod.step_size());
        }
    }

    has_transition.then_some(transition_step as i32)
}

pub(super) fn lod_transition_step(
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    px: u32,
    py: u32,
    pz: u32,
) -> Option<i32> {
    lod_transition_step_for_padded_size(my_lod, neighbor_lods, px, py, pz, LOD0_PADDED_SIZE)
}

/// Outward-apron band test for the *coarse* side of an LOD transition.
///
/// Returns `Some(depth)` when cell `(px, py, pz)` lies in the outer boundary band
/// (outer two padded planes) of a face whose neighbour is *finer* (lower LOD
/// index) than `my_lod`. `depth` is how far in from the outermost padded plane the
/// cell sits (0 = outermost), used to grade the apron bias. Mirrors the face/band
/// table in [`lod_transition_step_for_padded_size`] but keyed on a finer (not
/// merely differing) neighbour. Because it only fires toward finer neighbours, two
/// equal-LOD coarse chunks never apply it, so it introduces no new coarse-coarse
/// seam.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BaseSdfTransitionMode {
    Coarsen,
}

pub(super) fn generate_low_lod_sdf_with_smoothing<const N: usize>(
    chunk: &Chunk,
    world: &VoxelWorld,
    padded_size: u32,
    step: i32,
    linearize: impl Fn([u32; 3]) -> u32,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    smooth_coarse: bool,
) -> [f32; N] {
    generate_low_lod_sdf_with_smoothing_and_transition_mode(
        chunk,
        world,
        padded_size,
        step,
        linearize,
        my_lod,
        neighbor_lods,
        smooth_coarse,
        BaseSdfTransitionMode::Coarsen,
    )
}

pub(super) fn generate_low_lod_sdf_with_smoothing_and_transition_mode<const N: usize>(
    chunk: &Chunk,
    world: &VoxelWorld,
    padded_size: u32,
    step: i32,
    linearize: impl Fn([u32; 3]) -> u32,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    smooth_coarse: bool,
    transition_mode: BaseSdfTransitionMode,
) -> [f32; N] {
    let mut sdf = [1.0f32; N];
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    for z in 0..padded_size {
        for y in 0..padded_size {
            for x in 0..padded_size {
                let idx = linearize([x, y, z]) as usize;
                let transition_step = if transition_mode == BaseSdfTransitionMode::Coarsen {
                    lod_transition_step_for_padded_size(my_lod, neighbor_lods, x, y, z, padded_size)
                } else {
                    None
                };
                let effective_step = transition_step.unwrap_or(step);
                let base_world_pos = coarse_aligned_lod_sample_base_with_stride(
                    chunk_origin,
                    x,
                    y,
                    z,
                    step,
                    effective_step,
                );
                sdf[idx] = if smooth_coarse {
                    // Coarse cell: step-scaled anti-terrace blur so the mesh stops
                    // snapping to the coarse lattice. On LOD-transition cells use
                    // the coarser neighbor's effective step so both sides agree.
                    if transition_step.is_some() {
                        coarse_transition_smoothed_sdf_at_world_pos(
                            world,
                            base_world_pos,
                            effective_step,
                        )
                    } else {
                        coarse_smoothed_sdf_at_world_pos(world, base_world_pos, effective_step)
                    }
                } else {
                    // Legacy coarse field for A/B baselines.
                    smoothed_terrain_sdf_at_world_pos(world, base_world_pos)
                };
            }
        }
    }

    smooth_lod_sdf_interior(&sdf, padded_size, linearize, 0.5)
}

pub(super) fn coarse_aligned_lod_sample_base(
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
    step: i32,
) -> IVec3 {
    coarse_aligned_lod_sample_base_with_stride(chunk_origin, px, py, pz, 1, step)
}

pub(crate) fn coarse_aligned_lod_sample_base_with_stride(
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
    sample_stride: i32,
    step: i32,
) -> IVec3 {
    let local = IVec3::new(px as i32 - 1, py as i32 - 1, pz as i32 - 1);
    let local = local * sample_stride;
    let aligned = IVec3::new(
        local.x.div_euclid(step) * step,
        local.y.div_euclid(step) * step,
        local.z.div_euclid(step) * step,
    );
    chunk_origin + aligned
}

pub(super) fn sample_lod_sdf_at_world_pos(world: &VoxelWorld, world_pos: IVec3) -> f32 {
    if sample_voxel_at_world_pos(world, world_pos) {
        -1.0
    } else {
        1.0
    }
}

/// Per-mesh-generation memoized smoothed-SDF field for gradient-normal sampling.
///
/// `sdf_gradient_normal_at_local` re-derives the smoothed terrain field through
/// `VoxelWorld`'s chunk `HashMap` on every tap: 6 gradient taps × 8 trilinear
/// corners × up to 28 occupancy reads ≈ 1.3k hashmap lookups per call, and one
/// chunk mesh makes thousands of calls over the same lattice points. This cache
/// memoizes occupancy and smoothed lattice values in flat arrays covering the
/// chunk's padded neighbourhood, so repeated taps become array reads. Values
/// match the uncached helpers exactly; lattice points outside the cached window
/// fall back to the uncached path, so callers never need to range-check.
pub(crate) struct MeshSdfCache {
    chunk_origin: IVec3,
    lattice_min: i32,
    size: i32,
    /// NaN = not yet computed.
    occupancy: Vec<f32>,
    /// NaN = not yet computed.
    smoothed: Vec<f32>,
}

impl MeshSdfCache {
    pub(crate) fn new(chunk_origin: IVec3, my_lod: LodLevel) -> Self {
        let step = (my_lod.step_size().max(1)) as i32;
        // Mesh verts live in [-step, CHUNK_SIZE); morph/stitch targets stay within
        // one coarse step of the boundary; gradient taps reach ±1.5 voxels and the
        // smoothing kernel one more. ±(step + 4) covers all of it.
        let lattice_min = -(step + 4);
        let lattice_max = CHUNK_SIZE_I32 + step + 4;
        let size = lattice_max - lattice_min + 1;
        let volume = (size * size * size) as usize;
        Self {
            chunk_origin,
            lattice_min,
            size,
            occupancy: vec![f32::NAN; volume],
            smoothed: vec![f32::NAN; volume],
        }
    }

    #[inline]
    fn index(&self, lattice: IVec3) -> Option<usize> {
        let rel = lattice - IVec3::splat(self.lattice_min);
        if rel.x < 0
            || rel.y < 0
            || rel.z < 0
            || rel.x >= self.size
            || rel.y >= self.size
            || rel.z >= self.size
        {
            return None;
        }
        Some((rel.x + rel.y * self.size + rel.z * self.size * self.size) as usize)
    }

    #[inline]
    fn occupancy_at(&mut self, world: &VoxelWorld, lattice: IVec3) -> f32 {
        let Some(idx) = self.index(lattice) else {
            return terrain_occupancy_sdf_at_world(world, self.chunk_origin + lattice);
        };
        let cached = self.occupancy[idx];
        if !cached.is_nan() {
            return cached;
        }
        let value = terrain_occupancy_sdf_at_world(world, self.chunk_origin + lattice);
        self.occupancy[idx] = value;
        value
    }

    /// Memoized [`smoothed_terrain_sdf_at_world_pos`] keyed on chunk-local lattice points.
    fn smoothed_at(&mut self, world: &VoxelWorld, lattice: IVec3) -> f32 {
        let Some(idx) = self.index(lattice) else {
            return smoothed_terrain_sdf_at_world_pos(world, self.chunk_origin + lattice);
        };
        let cached = self.smoothed[idx];
        if !cached.is_nan() {
            return cached;
        }
        const W: [f32; 3] = [1.0, 2.0, 1.0];
        const SIGN_GUARD: f32 = 1.0e-3;
        let value = if self.occupancy_at(world, lattice) < 0.0 {
            -1.0
        } else {
            let mut sum = 0.0;
            let mut weight = 0.0;
            for (oz, &wz) in W.iter().enumerate() {
                for (oy, &wy) in W.iter().enumerate() {
                    for (ox, &wx) in W.iter().enumerate() {
                        let w = wx * wy * wz;
                        let offset = IVec3::new(ox as i32 - 1, oy as i32 - 1, oz as i32 - 1);
                        sum += w * self.occupancy_at(world, lattice + offset);
                        weight += w;
                    }
                }
            }
            (sum / weight).max(SIGN_GUARD)
        };
        self.smoothed[idx] = value;
        value
    }

    /// Memoized [`trilinear_smoothed_terrain_sdf_at_world_pos`] in chunk-local space.
    fn trilinear_at(&mut self, world: &VoxelWorld, local_pos: Vec3) -> f32 {
        let base = IVec3::new(
            local_pos.x.floor() as i32,
            local_pos.y.floor() as i32,
            local_pos.z.floor() as i32,
        );
        let frac = (local_pos - base.as_vec3()).clamp(Vec3::ZERO, Vec3::ONE);
        let mut corners = [0.0f32; 8];
        for (i, corner) in corners.iter_mut().enumerate() {
            let offset = IVec3::new((i & 1) as i32, ((i >> 1) & 1) as i32, ((i >> 2) & 1) as i32);
            *corner = self.smoothed_at(world, base + offset);
        }
        let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
        let x00 = lerp(corners[0], corners[1], frac.x);
        let x10 = lerp(corners[2], corners[3], frac.x);
        let x01 = lerp(corners[4], corners[5], frac.x);
        let x11 = lerp(corners[6], corners[7], frac.x);
        let y0 = lerp(x00, x10, frac.y);
        let y1 = lerp(x01, x11, frac.y);
        lerp(y0, y1, frac.z)
    }

    /// Cached equivalent of [`sdf_gradient_normal_at_local`].
    pub(crate) fn gradient_normal_at_local(
        &mut self,
        world: &VoxelWorld,
        local_pos: Vec3,
    ) -> [f32; 3] {
        let h = 0.5;
        let gradient = Vec3::new(
            self.trilinear_at(world, local_pos + Vec3::X * h)
                - self.trilinear_at(world, local_pos + Vec3::NEG_X * h),
            self.trilinear_at(world, local_pos + Vec3::Y * h)
                - self.trilinear_at(world, local_pos + Vec3::NEG_Y * h),
            self.trilinear_at(world, local_pos + Vec3::Z * h)
                - self.trilinear_at(world, local_pos + Vec3::NEG_Z * h),
        );
        let normal = gradient.normalize_or_zero();
        if normal.length_squared() > 0.0 {
            normal.to_array()
        } else {
            [0.0, 1.0, 0.0]
        }
    }
}

pub(crate) fn sdf_gradient_normal_at_local(
    world: &VoxelWorld,
    chunk_origin: IVec3,
    local_pos: Vec3,
) -> [f32; 3] {
    let world_pos = chunk_origin.as_vec3() + local_pos;
    let sample =
        |offset: Vec3| trilinear_smoothed_terrain_sdf_at_world_pos(world, world_pos + offset);
    let h = 0.5;
    let gradient = Vec3::new(
        sample(Vec3::X * h) - sample(Vec3::NEG_X * h),
        sample(Vec3::Y * h) - sample(Vec3::NEG_Y * h),
        sample(Vec3::Z * h) - sample(Vec3::NEG_Z * h),
    );
    let normal = gradient.normalize_or_zero();
    if normal.length_squared() > 0.0 {
        normal.to_array()
    } else {
        [0.0, 1.0, 0.0]
    }
}

pub(super) fn trilinear_smoothed_terrain_sdf_at_world_pos(
    world: &VoxelWorld,
    world_pos: Vec3,
) -> f32 {
    let base = IVec3::new(
        world_pos.x.floor() as i32,
        world_pos.y.floor() as i32,
        world_pos.z.floor() as i32,
    );
    let frac = (world_pos - base.as_vec3()).clamp(Vec3::ZERO, Vec3::ONE);
    let sample = |dx: i32, dy: i32, dz: i32| {
        smoothed_terrain_sdf_at_world_pos(world, base + IVec3::new(dx, dy, dz))
    };
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;

    let x00 = lerp(sample(0, 0, 0), sample(1, 0, 0), frac.x);
    let x10 = lerp(sample(0, 1, 0), sample(1, 1, 0), frac.x);
    let x01 = lerp(sample(0, 0, 1), sample(1, 0, 1), frac.x);
    let x11 = lerp(sample(0, 1, 1), sample(1, 1, 1), frac.x);
    let y0 = lerp(x00, x10, frac.y);
    let y1 = lerp(x01, x11, frac.y);
    lerp(y0, y1, frac.z)
}

pub fn lod_delta_gt_one_face_mask(my_lod: LodLevel, neighbor_lods: &NeighborLods) -> u8 {
    let Some(my_index) = my_lod.lod_index() else {
        return 0;
    };
    let mut mask = 0;
    for face in ChunkFace::ALL {
        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        let Some(neighbor_index) = neighbor_lod.lod_index() else {
            continue;
        };
        if my_index.abs_diff(neighbor_index) > 1 {
            mask |= LodTransitionSnapStats::face_mask(face);
        }
    }
    mask
}

pub(super) const SDF_SIGN_GUARD: f32 = 1.0e-3;

#[inline]
pub(super) fn preserve_sdf_sign(raw: f32, candidate: f32) -> f32 {
    if raw < 0.0 {
        candidate.min(-SDF_SIGN_GUARD)
    } else {
        candidate.max(SDF_SIGN_GUARD)
    }
}

pub(super) fn smooth_lod_sdf_interior<const N: usize>(
    sdf: &[f32; N],
    padded_size: u32,
    linearize: impl Fn([u32; 3]) -> u32,
    current_weight: f32,
) -> [f32; N] {
    if padded_size < 5 {
        return *sdf;
    }

    let neighbor_weight = 1.0 - current_weight;
    let mut smoothed = *sdf;
    let last_interior = padded_size - 3;
    // Sign-preserving clamp — see also `smoothed_terrain_sdf_at_world_pos` and
    // `smoothed_sdf_from_block`. A 50/50 mix of an air cell (`+0.5`) with a
    // mostly-solid neighbour average (`-0.58`) crosses zero (`-0.04`). MC's
    // case index uses `< 0.0` per corner, so a sign flip in this smoothing
    // step changes the MC case and produces static holes in the resulting
    // mesh. Surface Nets is robust to it; MC is not.
    for z in 2..=last_interior {
        for y in 2..=last_interior {
            for x in 2..=last_interior {
                let idx = linearize([x, y, z]) as usize;
                let current = sdf[idx];
                let neighbors = [
                    sdf[linearize([x - 1, y, z]) as usize],
                    sdf[linearize([x + 1, y, z]) as usize],
                    sdf[linearize([x, y - 1, z]) as usize],
                    sdf[linearize([x, y + 1, z]) as usize],
                    sdf[linearize([x, y, z - 1]) as usize],
                    sdf[linearize([x, y, z + 1]) as usize],
                ];

                if neighbors
                    .iter()
                    .any(|&neighbor| (neighbor < 0.0) != (current < 0.0))
                {
                    let neighbor_avg = neighbors.iter().sum::<f32>() / neighbors.len() as f32;
                    let mixed = current * current_weight + neighbor_avg * neighbor_weight;
                    smoothed[idx] = preserve_sdf_sign(current, mixed);
                }
            }
        }
    }

    smoothed
}

/// LOD0 production policy: smooth the terrain SDF to remove Surface-Nets
/// terracing from the binary occupancy field. See `smooth_terrain_sdf_lod0`.
pub(super) const SMOOTH_TERRAIN_SDF_LOD0: bool = true;

/// Edge length of the world-space occupancy block used for LOD0 SDF smoothing:
/// the 18³ padded grid plus a one-cell ring on each side so every padded cell
/// has its full 3³ smoothing neighbourhood available from real world voxels.
pub(super) const SDF_SMOOTH_BLOCK_SIZE: usize = LOD0_PADDED_SIZE as usize + 2; // 20

/// Occupancy at a world voxel using the same water-as-solid convention as
/// `sample_voxel_solid`, so the smoothed field matches the raw LOD0 field.
#[inline]
pub(super) fn terrain_occupancy_sdf_at_world(world: &VoxelWorld, world_pos: IVec3) -> f32 {
    let voxel = terrain_meshing_voxel_at(world, world_pos);
    if voxel.is_solid() || voxel.is_liquid() {
        -1.0
    } else {
        1.0
    }
}

/// Sample occupancy into a `SDF_SMOOTH_BLOCK_SIZE³` block. Block index `a` maps
/// to world voxel `chunk_origin + (a - 2)`, so padded cell `px` (world voxel
/// `chunk_origin + (px - 1)`) is centred at block index `px + 1` with its ±1
/// neighbours at `px` and `px + 2` — all inside `0..SDF_SMOOTH_BLOCK_SIZE`.
pub(super) fn build_sdf_smoothing_block(world: &VoxelWorld, chunk_origin: IVec3) -> Vec<f32> {
    let n = SDF_SMOOTH_BLOCK_SIZE;
    let mut block = vec![1.0f32; n * n * n];
    for c in 0..n {
        for b in 0..n {
            for a in 0..n {
                let world_pos = chunk_origin + IVec3::new(a as i32 - 2, b as i32 - 2, c as i32 - 2);
                block[a + b * n + c * n * n] = terrain_occupancy_sdf_at_world(world, world_pos);
            }
        }
    }
    block
}

/// 1-2-1 separable (Gaussian-like) blur of the occupancy block at padded cell
/// `(px, py, pz)`. The result is a fractional SDF whose zero crossing
/// interpolates between voxel layers, so Surface Nets stops snapping vertices
/// to the voxel lattice (the terracing). Because it reads only world occupancy,
/// two adjacent chunks produce identical values on shared cells.
///
/// To preserve thin features (a single-voxel patch would otherwise blur to
/// air), occupied centre samples stay fully negative while air samples receive
/// the fractional blur. This preserves edits/caves/overhangs that smoothing would
/// otherwise erase, while still moving interpolation off the voxel stair step.
///
/// Air samples are clamped to ≥ `SIGN_GUARD`. The clamp matters for the MC
/// consumer: classical MC's case index uses `< 0.0` per corner. Without it, an
/// air cell with mostly-solid neighbours can blur to a small NEGATIVE value,
/// flipping that corner's bit and selecting a wrong MC case → missing
/// triangles → scattered holes across the surface. Surface Nets tolerates the
/// sign flip; MC does not. Must mirror `smoothed_terrain_sdf_at_world_pos`.
pub(super) fn smoothed_sdf_from_block(block: &[f32], px: u32, py: u32, pz: u32) -> f32 {
    const W: [f32; 3] = [1.0, 2.0, 1.0];
    const SIGN_GUARD: f32 = 1.0e-3;
    let n = SDF_SMOOTH_BLOCK_SIZE;
    let (px, py, pz) = (px as usize, py as usize, pz as usize);
    let mut sum = 0.0;
    let mut weight = 0.0;
    for (oz, &wz) in W.iter().enumerate() {
        for (oy, &wy) in W.iter().enumerate() {
            for (ox, &wx) in W.iter().enumerate() {
                let w = wx * wy * wz;
                let idx = (px + ox) + (py + oy) * n + (pz + oz) * n * n;
                sum += w * block[idx];
                weight += w;
            }
        }
    }
    let smoothed = sum / weight;
    let raw = block[(px + 1) + (py + 1) * n + (pz + 1) * n * n];
    if raw < 0.0 {
        -1.0
    } else {
        smoothed.max(SIGN_GUARD)
    }
}

/// Mesher SDF at a world position (matches Surface Nets / iso-band debug sampling).
pub fn mesher_smoothed_sdf_at_world_pos(world: &VoxelWorld, world_pos: Vec3) -> f32 {
    smoothed_terrain_sdf_at_world_pos(
        world,
        IVec3::new(
            world_pos.x.floor() as i32,
            world_pos.y.floor() as i32,
            world_pos.z.floor() as i32,
        ),
    )
}

pub(crate) fn smoothed_terrain_sdf_at_world_pos(world: &VoxelWorld, world_pos: IVec3) -> f32 {
    // Sign-preserving asymmetric blur:
    //   solid centre  → hard -1 (preserves thin features under blur),
    //   air centre    → 1-2-1 blur of 27 neighbours, clamped to ≥ SIGN_GUARD.
    // The clamp is critical for the MC consumer: classical MC's case index uses
    // `< 0.0` per corner. Without the clamp, an air cell with mostly-solid
    // neighbours can return a small NEGATIVE blur, flipping that corner's bit
    // and selecting a wrong MC case → missing triangles → scattered holes
    // across the surface. Surface Nets is robust to this; MC is not.
    const W: [f32; 3] = [1.0, 2.0, 1.0];
    const SIGN_GUARD: f32 = 1.0e-3;
    if terrain_occupancy_sdf_at_world(world, world_pos) < 0.0 {
        return -1.0;
    }

    let mut sum = 0.0;
    let mut weight = 0.0;
    for (oz, &wz) in W.iter().enumerate() {
        for (oy, &wy) in W.iter().enumerate() {
            for (ox, &wx) in W.iter().enumerate() {
                let w = wx * wy * wz;
                let offset = IVec3::new(ox as i32 - 1, oy as i32 - 1, oz as i32 - 1);
                sum += w * terrain_occupancy_sdf_at_world(world, world_pos + offset);
                weight += w;
            }
        }
    }
    (sum / weight).max(SIGN_GUARD)
}

/// Step-scaled anti-terrace blur for coarse LODs (LOD1/2/3).
///
/// Coarse-grid 1-2-1 occupancy blur. Interior coarse cells use the conservative
/// solid-centre policy from [`smoothed_terrain_sdf_at_world_pos`] to preserve thin
/// features; LOD-transition cells can soften solid centres while keeping a
/// negative guard so the MC case sign stays stable.
///
/// Reads only world occupancy at coarse-aligned offsets, so two adjacent coarse
/// chunks compute identical values on shared cells (no new seams). The
/// sign-preserving clamp is mandatory for the MC consumer for the same reason it
/// is in `smoothed_terrain_sdf_at_world_pos`.
pub(super) fn coarse_sdf_blur_at_world_pos(
    world: &VoxelWorld,
    world_pos: IVec3,
    step: i32,
    preserve_solid_center: bool,
) -> f32 {
    const W: [f32; 3] = [1.0, 2.0, 1.0];
    const SIGN_GUARD: f32 = 1.0e-3;
    const TRANSITION_SOLID_GUARD: f32 = 0.75;
    let center_sdf = terrain_occupancy_sdf_at_world(world, world_pos);
    if preserve_solid_center && center_sdf < 0.0 {
        return -1.0;
    }

    let h = step.max(1);
    let mut sum = 0.0;
    let mut weight = 0.0;
    for (oz, &wz) in W.iter().enumerate() {
        for (oy, &wy) in W.iter().enumerate() {
            for (ox, &wx) in W.iter().enumerate() {
                let w = wx * wy * wz;
                let offset = IVec3::new(
                    (ox as i32 - 1) * h,
                    (oy as i32 - 1) * h,
                    (oz as i32 - 1) * h,
                );
                sum += w * terrain_occupancy_sdf_at_world(world, world_pos + offset);
                weight += w;
            }
        }
    }
    let blurred = sum / weight;
    if center_sdf < 0.0 {
        blurred.min(-TRANSITION_SOLID_GUARD)
    } else {
        blurred.max(SIGN_GUARD)
    }
}

pub(super) fn coarse_smoothed_sdf_at_world_pos(
    world: &VoxelWorld,
    world_pos: IVec3,
    step: i32,
) -> f32 {
    coarse_sdf_blur_at_world_pos(world, world_pos, step, true)
}

pub(super) fn coarse_transition_smoothed_sdf_at_world_pos(
    world: &VoxelWorld,
    world_pos: IVec3,
    step: i32,
) -> f32 {
    coarse_sdf_blur_at_world_pos(world, world_pos, step, false)
}

/// Coarse-LOD anti-terrace smoothing gate (env `VOXELS_COARSE_SDF_SMOOTH`).
///
/// Default **on**: extends the LOD0 anti-terrace policy to LOD1/2/3 interior and
/// LOD-transition cells. Set `VOXELS_COARSE_SDF_SMOOTH=0` (or `false`) to restore
/// the legacy binary coarse field for an A/B baseline. Read once and cached.
pub(super) fn coarse_terrain_sdf_smooth_enabled() -> bool {
    static CACHE: OnceLock<bool> = OnceLock::new();
    *CACHE.get_or_init(|| {
        let enabled = std::env::var("VOXELS_COARSE_SDF_SMOOTH")
            .map(|v| !(v == "0" || v.eq_ignore_ascii_case("false")))
            .unwrap_or(true);
        if !enabled {
            info!(
                "Coarse-LOD SDF anti-terrace smoothing: DISABLED (VOXELS_COARSE_SDF_SMOOTH=0) — legacy binary coarse field"
            );
        }
        enabled
    })
}

/// Generate an SDF array from voxel data with 1-voxel padding for neighbor sampling.
/// Uses distance-based SDF for smoother surfaces at chunk boundaries.
/// This is the LOD0 (high detail) version - samples every voxel.
///
/// When `smooth` is set, cells get a world-space blurred SDF to remove terracing
/// (see `smoothed_sdf_from_block`). Live terrain remains uniformly fine at LOD0.
pub(super) fn generate_sdf(chunk: &Chunk, world: &VoxelWorld, smooth: bool) -> [f32; 5832] {
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    let smoothing_block = smooth.then(|| build_sdf_smoothing_block(world, chunk_origin));

    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        if let Some(block) = &smoothing_block {
            sdf[i] = smoothed_sdf_from_block(block, px, py, pz);
        } else {
            let is_solid = sample_voxel_solid(chunk, world, chunk_origin, px, py, pz);
            sdf[i] = if is_solid { -1.0 } else { 1.0 };
        }
    }

    sdf
}

pub(super) fn generate_sdf_with_transition_mode(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    smooth: bool,
    transition_mode: BaseSdfTransitionMode,
) -> [f32; 5832] {
    // 18^3 = 5832
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);

    let smoothing_block = smooth.then(|| build_sdf_smoothing_block(world, chunk_origin));

    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        let transition_step = if transition_mode == BaseSdfTransitionMode::Coarsen {
            lod_transition_step(my_lod, neighbor_lods, px, py, pz)
        } else {
            None
        };
        if let Some(step) = transition_step {
            let base_world_pos = coarse_aligned_lod_sample_base(chunk_origin, px, py, pz, step);
            sdf[i] = if smooth {
                coarse_transition_smoothed_sdf_at_world_pos(world, base_world_pos, step)
            } else {
                sample_lod_sdf_at_world_pos(world, base_world_pos)
            };
        } else if let Some(block) = &smoothing_block {
            // Fractional SDF from a world-space occupancy blur: removes terracing
            // while staying identical across chunk boundaries (no new seams).
            sdf[i] = smoothed_sdf_from_block(block, px, py, pz);
        } else {
            let is_solid = sample_voxel_solid(chunk, world, chunk_origin, px, py, pz);
            // SDF: negative inside solid, positive in air
            sdf[i] = if is_solid { -1.0 } else { 1.0 };
        }
    }

    sdf
}

/// Sample voxel at a world position, returns true if solid.
/// Used for LOD sampling where coordinates may be outside the chunk.
pub(super) fn sample_voxel_at_world_pos(world: &VoxelWorld, world_pos: IVec3) -> bool {
    let voxel = terrain_meshing_voxel_at(world, world_pos);
    voxel.is_solid() || voxel.is_liquid()
}
