#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_NODE_CHILDREN, NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, NAADF_PACKED_BLOCK_WORDS, NAADF_VOXELS_PER_BLOCK_AXIS, NAADF_VOXELS_PER_CHUNK, naadf_make_node
#import "shaders/naadf/layout.wgsl" naadf_voxel_index_in_block, naadf_voxel_index_in_chunk

@group(3) @binding(4) var<storage, read> naadf_raw_voxel_records: array<u32>;
@group(3) @binding(5) var<storage, read_write> naadf_block_records: array<u32>;

@compute @workgroup_size(64)
fn build_naadf_blocks(@builtin(global_invocation_id) id: vec3<u32>) {
    let global_block_index = id.x;
    let chunk_slot = global_block_index / NAADF_BLOCKS_PER_CHUNK;
    let block_index = global_block_index % NAADF_BLOCKS_PER_CHUNK;
    let block_coord = vec3<u32>(
        block_index % 4u,
        (block_index / 4u) % 4u,
        block_index / 16u,
    );
    let raw_chunk_base = chunk_slot * NAADF_VOXELS_PER_CHUNK;

    var occupied_count = 0u;
    var first_material = 0u;
    var occupancy_low = 0u;
    var occupancy_high = 0u;

    for (var z = 0u; z < NAADF_VOXELS_PER_BLOCK_AXIS; z = z + 1u) {
        for (var y = 0u; y < NAADF_VOXELS_PER_BLOCK_AXIS; y = y + 1u) {
            for (var x = 0u; x < NAADF_VOXELS_PER_BLOCK_AXIS; x = x + 1u) {
                let block_local = vec3<u32>(x, y, z);
                let chunk_local = block_coord * vec3<u32>(NAADF_VOXELS_PER_BLOCK_AXIS) + block_local;
                let raw_record = naadf_raw_voxel_records[
                    raw_chunk_base + naadf_voxel_index_in_chunk(chunk_local)
                ];
                if naadf_raw_voxel_occupied(raw_record) {
                    let bit_index = naadf_voxel_index_in_block(block_local);
                    if bit_index < 32u {
                        occupancy_low = occupancy_low | (1u << bit_index);
                    } else {
                        occupancy_high = occupancy_high | (1u << (bit_index - 32u));
                    }
                    if occupied_count == 0u {
                        first_material = naadf_raw_voxel_material(raw_record);
                    }
                    occupied_count = occupied_count + 1u;
                }
            }
        }
    }

    var node = naadf_make_node(NAADF_NODE_CHILDREN, 0u);
    if occupied_count == 0u {
        node = naadf_make_node(NAADF_NODE_UNIFORM_EMPTY, 0u);
    } else if occupied_count == 64u {
        node = naadf_make_node(NAADF_NODE_UNIFORM_FULL, first_material);
    }

    let output_base = global_block_index * NAADF_PACKED_BLOCK_WORDS;
    naadf_block_records[output_base + 0u] = node;
    naadf_block_records[output_base + 1u] = 0u;
    naadf_block_records[output_base + 2u] = occupancy_low;
    naadf_block_records[output_base + 3u] = occupancy_high;
    naadf_block_records[output_base + 4u] = 0u;
    naadf_block_records[output_base + 5u] = 0u;
    naadf_block_records[output_base + 6u] = 0u;
    naadf_block_records[output_base + 7u] = 0u;
}

fn naadf_raw_voxel_occupied(record: u32) -> bool {
    return (record & 0x80000000u) != 0u;
}

fn naadf_raw_voxel_material(record: u32) -> u32 {
    return record & 0x0000ffffu;
}
