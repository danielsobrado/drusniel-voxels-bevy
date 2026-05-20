#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_CHUNK_BOUND_OFFSET_NEG_X, NAADF_CHUNK_BOUND_OFFSET_NEG_Y, NAADF_CHUNK_BOUND_OFFSET_NEG_Z, NAADF_CHUNK_BOUND_OFFSET_POS_X, NAADF_CHUNK_BOUND_OFFSET_POS_Y, NAADF_CHUNK_BOUND_OFFSET_POS_Z, NAADF_NODE_UNIFORM_EMPTY, NAADF_PACKED_CHUNK_WORDS, NAADF_VOXELS_PER_CHUNK, naadf_node_state

struct NaadfChunkBoundsParams {
    chunk_count: u32,
    chunk_lookup_count: u32,
    _pad0: vec2<u32>,
}

@group(3) @binding(11) var<storage, read_write> naadf_chunk_records: array<u32>;
@group(3) @binding(12) var<uniform> naadf_chunk_bounds_params: NaadfChunkBoundsParams;
@group(3) @binding(20) var<storage, read> naadf_chunk_lookup_records: array<vec4<u32>>;
@group(3) @binding(30) var<storage, read> naadf_build_slots: array<u32>;

@compute @workgroup_size(64)
fn build_naadf_chunk_bounds(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= arrayLength(&naadf_build_slots) {
        return;
    }
    let chunk_index = naadf_build_slots[id.x];
    let chunk_count = min(
        naadf_chunk_bounds_params.chunk_count,
        arrayLength(&naadf_chunk_records) / NAADF_PACKED_CHUNK_WORDS,
    );
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
    // Conservative single-dispatch model: each direction counts contiguous
    // loaded-empty chunks only on that axis. This avoids the old O(n*r^3)
    // radius-slab heuristic and remains safe without requiring cross-workgroup
    // fixed-point propagation inside one dispatch. CPU cache propagation remains
    // the fuller upstream-style solver.
    let neg_x = naadf_count_axis_empty_chunks(chunk_pos, vec3<i32>(-1, 0, 0), chunk_count);
    let pos_x = naadf_count_axis_empty_chunks(chunk_pos, vec3<i32>(1, 0, 0), chunk_count);
    let neg_y = naadf_count_axis_empty_chunks(chunk_pos, vec3<i32>(0, -1, 0), chunk_count);
    let pos_y = naadf_count_axis_empty_chunks(chunk_pos, vec3<i32>(0, 1, 0), chunk_count);
    let neg_z = naadf_count_axis_empty_chunks(chunk_pos, vec3<i32>(0, 0, -1), chunk_count);
    let pos_z = naadf_count_axis_empty_chunks(chunk_pos, vec3<i32>(0, 0, 1), chunk_count);

    naadf_chunk_records[base + 6u] =
        (neg_x << NAADF_CHUNK_BOUND_OFFSET_NEG_X) |
        (pos_x << NAADF_CHUNK_BOUND_OFFSET_POS_X) |
        (neg_y << NAADF_CHUNK_BOUND_OFFSET_NEG_Y) |
        (pos_y << NAADF_CHUNK_BOUND_OFFSET_POS_Y) |
        (neg_z << NAADF_CHUNK_BOUND_OFFSET_NEG_Z) |
        (pos_z << NAADF_CHUNK_BOUND_OFFSET_POS_Z);
}

fn naadf_count_axis_empty_chunks(origin: vec3<i32>, direction: vec3<i32>, chunk_count: u32) -> u32 {
    var count = 0u;
    for (var distance = 1u; distance <= 31u; distance = distance + 1u) {
        let target_chunk = origin + direction * vec3<i32>(i32(distance));
        if !naadf_loaded_empty_chunk(target_chunk, chunk_count) {
            return count;
        }
        count = distance;
    }
    return count;
}

fn naadf_loaded_empty_chunk(chunk_pos: vec3<i32>, chunk_count: u32) -> bool {
    let slot = naadf_lookup_chunk_slot(chunk_pos);
    if slot == 0xffffffffu || slot >= chunk_count {
        return false;
    }
    let base = slot * NAADF_PACKED_CHUNK_WORDS;
    return naadf_chunk_record_valid(base) &&
        naadf_node_state(naadf_chunk_records[base + 0u]) == NAADF_NODE_UNIFORM_EMPTY;
}

fn naadf_lookup_chunk_slot(chunk_pos: vec3<i32>) -> u32 {
    let lookup_count = min(
        naadf_chunk_bounds_params.chunk_lookup_count,
        arrayLength(&naadf_chunk_lookup_records),
    );
    var low = 0u;
    var high = lookup_count;
    for (var i = 0u; i < 32u; i = i + 1u) {
        if low >= high {
            break;
        }
        let mid = (low + high) / 2u;
        let record = naadf_chunk_lookup_records[mid];
        let record_pos = vec3<i32>(
            bitcast<i32>(record.x),
            bitcast<i32>(record.y),
            bitcast<i32>(record.z),
        );
        let comparison = naadf_compare_chunk_pos(record_pos, chunk_pos);
        if comparison == 0i {
            return record.w;
        }
        if comparison < 0i {
            low = mid + 1u;
        } else {
            high = mid;
        }
    }
    return 0xffffffffu;
}

fn naadf_compare_chunk_pos(a: vec3<i32>, b: vec3<i32>) -> i32 {
    if a.x < b.x {
        return -1i;
    }
    if a.x > b.x {
        return 1i;
    }
    if a.y < b.y {
        return -1i;
    }
    if a.y > b.y {
        return 1i;
    }
    if a.z < b.z {
        return -1i;
    }
    if a.z > b.z {
        return 1i;
    }
    return 0i;
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
