use crate::voxel::meshing::mc_support;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

pub fn sdf_gradient_normal_at_world(
    world: &VoxelWorld,
    chunk_origin: IVec3,
    local_pos: Vec3,
) -> [f32; 3] {
    mc_support::gradient_normal(world, chunk_origin, local_pos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CHUNK_SIZE_I32;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;
    use crate::voxel::world::VoxelWorld;
    use bevy::prelude::IVec3;

    fn solid_chunk(pos: IVec3) -> (VoxelWorld, IVec3) {
        let mut world = VoxelWorld::new(IVec3::new(4, 4, 4));
        world.insert_chunk(Chunk::new(pos));
        for z in 0..CHUNK_SIZE_I32 {
            for y in 0..CHUNK_SIZE_I32 {
                for x in 0..CHUNK_SIZE_I32 {
                    world.set_voxel(pos * CHUNK_SIZE_I32 + IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
        (world, pos)
    }

    #[test]
    fn gradient_normals_are_unit_length() {
        let (world, chunk_pos) = solid_chunk(IVec3::ZERO);
        let chunk = world.get_chunk(chunk_pos).unwrap();
        let origin = VoxelWorld::chunk_to_world(chunk_pos);
        let local = Vec3::new(8.0, 8.0, 8.0);
        let n = sdf_gradient_normal_at_world(&world, origin, local);
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        assert!(len > 0.99 && len < 1.01);
        assert!(n.iter().all(|v| v.is_finite()));
        let _ = chunk;
    }
}
