#import "shaders/naadf/common.wgsl"

fn naadf_voxel_index_in_chunk(local: vec3<u32>) -> u32 {
    return local.x + local.y * NAADF_VOXELS_PER_CHUNK_AXIS +
        local.z * NAADF_VOXELS_PER_CHUNK_AXIS * NAADF_VOXELS_PER_CHUNK_AXIS;
}
