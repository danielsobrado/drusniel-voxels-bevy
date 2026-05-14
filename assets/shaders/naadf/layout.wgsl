#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK_AXIS, NAADF_VOXELS_PER_BLOCK_AXIS, NAADF_VOXELS_PER_CHUNK_AXIS

fn naadf_voxel_index_in_chunk(local: vec3<u32>) -> u32 {
    return local.x + local.y * NAADF_VOXELS_PER_CHUNK_AXIS +
        local.z * NAADF_VOXELS_PER_CHUNK_AXIS * NAADF_VOXELS_PER_CHUNK_AXIS;
}

fn naadf_block_index_in_chunk(block: vec3<u32>) -> u32 {
    return block.x + block.y * NAADF_BLOCKS_PER_CHUNK_AXIS +
        block.z * NAADF_BLOCKS_PER_CHUNK_AXIS * NAADF_BLOCKS_PER_CHUNK_AXIS;
}

fn naadf_voxel_index_in_block(local: vec3<u32>) -> u32 {
    return local.x + local.y * NAADF_VOXELS_PER_BLOCK_AXIS +
        local.z * NAADF_VOXELS_PER_BLOCK_AXIS * NAADF_VOXELS_PER_BLOCK_AXIS;
}

fn naadf_block_coord_for_voxel(local: vec3<u32>) -> vec3<u32> {
    return local / vec3<u32>(NAADF_VOXELS_PER_BLOCK_AXIS);
}

fn naadf_local_coord_in_block(local: vec3<u32>) -> vec3<u32> {
    return local % vec3<u32>(NAADF_VOXELS_PER_BLOCK_AXIS);
}

fn naadf_chunk_world_origin(chunk_pos: vec3<i32>) -> vec3<i32> {
    return chunk_pos * vec3<i32>(16i);
}
