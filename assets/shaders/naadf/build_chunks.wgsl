#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_NODE_CHILDREN, NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, NAADF_PACKED_BLOCK_WORDS, NAADF_PACKED_CHUNK_WORDS, NAADF_VOXELS_PER_CHUNK, naadf_make_node, naadf_node_payload, naadf_node_state

@group(3) @binding(5) var<storage, read> naadf_block_records: array<u32>;
@group(3) @binding(11) var<storage, read_write> naadf_chunk_records: array<u32>;
@group(3) @binding(30) var<storage, read> naadf_build_slots: array<u32>;

@compute @workgroup_size(64, 1, 1)
fn build_naadf_chunks(
    @builtin(workgroup_id) workgroup_id: vec3<u32>,
    @builtin(local_invocation_index) local_index: u32,
) {
    if local_index != 0u {
        return;
    }

    let chunk_index = naadf_build_slots[workgroup_id.x];
    let block_base = chunk_index * NAADF_BLOCKS_PER_CHUNK * NAADF_PACKED_BLOCK_WORDS;
    let chunk_base = chunk_index * NAADF_PACKED_CHUNK_WORDS;
    if naadf_chunk_records[chunk_base + 4u] != NAADF_BLOCKS_PER_CHUNK ||
        naadf_chunk_records[chunk_base + 5u] != NAADF_VOXELS_PER_CHUNK {
        return;
    }

    let block_node = naadf_block_records[block_base + 0u];
    let block_state = naadf_node_state(block_node);
    let block_payload = naadf_node_payload(block_node);

    var all_empty = block_state == NAADF_NODE_UNIFORM_EMPTY;
    var all_full_same_material = block_state == NAADF_NODE_UNIFORM_FULL;
    var shared_material = block_payload;

    for (var i = 1u; i < NAADF_BLOCKS_PER_CHUNK; i = i + 1u) {
        let other_base = (chunk_index * NAADF_BLOCKS_PER_CHUNK + i) * NAADF_PACKED_BLOCK_WORDS;
        let other_node = naadf_block_records[other_base + 0u];
        let other_state = naadf_node_state(other_node);
        let other_payload = naadf_node_payload(other_node);

        all_empty = all_empty && other_state == NAADF_NODE_UNIFORM_EMPTY;
        all_full_same_material = all_full_same_material &&
            other_state == NAADF_NODE_UNIFORM_FULL &&
            other_payload == shared_material;
    }

    var chunk_node = naadf_make_node(NAADF_NODE_CHILDREN, 0u);
    if all_empty {
        chunk_node = naadf_make_node(NAADF_NODE_UNIFORM_EMPTY, 0u);
    } else if all_full_same_material {
        chunk_node = naadf_make_node(NAADF_NODE_UNIFORM_FULL, shared_material);
    }

    naadf_chunk_records[chunk_base + 0u] = chunk_node;
    naadf_chunk_records[chunk_base + 4u] = NAADF_BLOCKS_PER_CHUNK;
    naadf_chunk_records[chunk_base + 5u] = NAADF_VOXELS_PER_CHUNK;
    naadf_chunk_records[chunk_base + 7u] = 0u;
}
