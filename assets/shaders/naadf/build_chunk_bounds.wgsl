#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_CHUNK_BOUND_OFFSET_NEG_X, NAADF_CHUNK_BOUND_OFFSET_NEG_Y, NAADF_CHUNK_BOUND_OFFSET_NEG_Z, NAADF_CHUNK_BOUND_OFFSET_POS_X, NAADF_CHUNK_BOUND_OFFSET_POS_Y, NAADF_CHUNK_BOUND_OFFSET_POS_Z, NAADF_NODE_UNIFORM_EMPTY, NAADF_PACKED_CHUNK_WORDS, NAADF_VOXELS_PER_CHUNK, naadf_node_state

@group(3) @binding(11) var<storage, read_write> naadf_chunk_records: array<u32>;

@compute @workgroup_size(64)
fn build_naadf_chunk_bounds(@builtin(global_invocation_id) id: vec3<u32>) {
    let chunk_index = id.x;
    let chunk_count = arrayLength(&naadf_chunk_records) / NAADF_PACKED_CHUNK_WORDS;
    if chunk_index >= chunk_count {
        return;
    }

    let base = chunk_index * NAADF_PACKED_CHUNK_WORDS;
    if !naadf_chunk_record_valid(base) {
        return;
    }
    let node = naadf_chunk_records[base + 0u];
    if naadf_node_state(node) != NAADF_NODE_UNIFORM_EMPTY {
        naadf_chunk_records[base + 6u] = 0u;
        return;
    }

    let chunk_pos = naadf_chunk_position(base);
    let neg_x = naadf_count_loaded_empty_chunks(chunk_pos, vec3<i32>(-1, 0, 0), chunk_count);
    let pos_x = naadf_count_loaded_empty_chunks(chunk_pos, vec3<i32>(1, 0, 0), chunk_count);
    let neg_y = naadf_count_loaded_empty_chunks(chunk_pos, vec3<i32>(0, -1, 0), chunk_count);
    let pos_y = naadf_count_loaded_empty_chunks(chunk_pos, vec3<i32>(0, 1, 0), chunk_count);
    let neg_z = naadf_count_loaded_empty_chunks(chunk_pos, vec3<i32>(0, 0, -1), chunk_count);
    let pos_z = naadf_count_loaded_empty_chunks(chunk_pos, vec3<i32>(0, 0, 1), chunk_count);

    naadf_chunk_records[base + 6u] =
        (neg_x << NAADF_CHUNK_BOUND_OFFSET_NEG_X) |
        (pos_x << NAADF_CHUNK_BOUND_OFFSET_POS_X) |
        (neg_y << NAADF_CHUNK_BOUND_OFFSET_NEG_Y) |
        (pos_y << NAADF_CHUNK_BOUND_OFFSET_POS_Y) |
        (neg_z << NAADF_CHUNK_BOUND_OFFSET_NEG_Z) |
        (pos_z << NAADF_CHUNK_BOUND_OFFSET_POS_Z);
}

fn naadf_count_loaded_empty_chunks(origin: vec3<i32>, direction: vec3<i32>, chunk_count: u32) -> u32 {
    var count = 0u;
    for (var distance = 1u; distance <= 31u; distance = distance + 1u) {
        let target = origin + direction * vec3<i32>(i32(distance));
        let slot = naadf_find_chunk_slot(target, chunk_count);
        if slot < 0i {
            return count;
        }
        let base = u32(slot) * NAADF_PACKED_CHUNK_WORDS;
        if !naadf_chunk_record_valid(base) {
            return count;
        }
        if naadf_node_state(naadf_chunk_records[base + 0u]) != NAADF_NODE_UNIFORM_EMPTY {
            return count;
        }
        count = distance;
    }
    return count;
}

fn naadf_find_chunk_slot(target: vec3<i32>, chunk_count: u32) -> i32 {
    for (var index = 0u; index < chunk_count; index = index + 1u) {
        let base = index * NAADF_PACKED_CHUNK_WORDS;
        if !naadf_chunk_record_valid(base) {
            continue;
        }
        if all(naadf_chunk_position(base) == target) {
            return i32(index);
        }
    }
    return -1i;
}

fn naadf_chunk_position(base: u32) -> vec3<i32> {
    return vec3<i32>(
        bitcast<i32>(naadf_chunk_records[base + 1u]),
        bitcast<i32>(naadf_chunk_records[base + 2u]),
        bitcast<i32>(naadf_chunk_records[base + 3u]),
    );
}

fn naadf_chunk_record_valid(base: u32) -> bool {
    return naadf_chunk_records[base + 4u] == NAADF_BLOCKS_PER_CHUNK &&
        naadf_chunk_records[base + 5u] == NAADF_VOXELS_PER_CHUNK;
}
