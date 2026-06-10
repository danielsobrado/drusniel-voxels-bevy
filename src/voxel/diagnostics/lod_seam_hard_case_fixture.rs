//! Deterministic voxel sculpts for LOD seam hard-case bench checkpoints.

use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::IVec3;

const CHUNK_VOXELS: i32 = 16;

/// Apply sculpted topology for `bench/scenes/lod-seam-hard-cases.toml`.
/// Safe to call multiple times (idempotent edits).
pub fn apply_lod_seam_hard_case_fixture(world: &mut VoxelWorld) {
    carve_cave_mouth_x_seam(world, IVec3::new(272, 64, 272));
    carve_overhang_z_seam(world, IVec3::new(288, 72, 256));
    carve_dual_sheet_cave_face(world, IVec3::new(304, 60, 288));
    sculpt_near_tangent_cliff_boundary(world, IVec3::new(256, 80, 304));
    carve_multi_component_hint(world, IVec3::new(320, 68, 272));
}

fn carve_air_box(world: &mut VoxelWorld, min: IVec3, max: IVec3) {
    for x in min.x..=max.x {
        for y in min.y..=max.y {
            for z in min.z..=max.z {
                let _ = world.set_voxel(IVec3::new(x, y, z), VoxelType::Air);
            }
        }
    }
}

fn carve_cave_mouth_x_seam(world: &mut VoxelWorld, origin: IVec3) {
    carve_air_box(
        world,
        origin + IVec3::new(-2, 2, 2),
        origin + IVec3::new(CHUNK_VOXELS + 2, 8, 12),
    );
}

fn carve_overhang_z_seam(world: &mut VoxelWorld, origin: IVec3) {
    carve_air_box(
        world,
        origin + IVec3::new(2, 6, -2),
        origin + IVec3::new(12, 10, CHUNK_VOXELS + 2),
    );
    for x in origin.x + 2..=origin.x + 12 {
        for z in origin.z + 4..=origin.z + CHUNK_VOXELS {
            let _ = world.set_voxel(IVec3::new(x, origin.y + 10, z), VoxelType::TopSoil);
        }
    }
}

fn carve_dual_sheet_cave_face(world: &mut VoxelWorld, origin: IVec3) {
    carve_air_box(
        world,
        origin + IVec3::new(2, 2, 2),
        origin + IVec3::new(6, 7, 6),
    );
    carve_air_box(
        world,
        origin + IVec3::new(9, 4, 2),
        origin + IVec3::new(13, 9, 6),
    );
}

fn sculpt_near_tangent_cliff_boundary(world: &mut VoxelWorld, origin: IVec3) {
    for x in origin.x..=origin.x + CHUNK_VOXELS {
        for z in origin.z..=origin.z + CHUNK_VOXELS {
            let rise = ((x - origin.x) as f32 * 0.35) as i32;
            for y in origin.y + rise..=origin.y + rise + 3 {
                let _ = world.set_voxel(IVec3::new(x, y, z), VoxelType::TopSoil);
            }
        }
    }
}

fn carve_multi_component_hint(world: &mut VoxelWorld, origin: IVec3) {
    carve_air_box(
        world,
        origin + IVec3::new(1, 1, 1),
        origin + IVec3::new(5, 6, 5),
    );
    carve_air_box(
        world,
        origin + IVec3::new(10, 3, 1),
        origin + IVec3::new(14, 8, 5),
    );
}
