#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_NODE_UNIFORM_EMPTY, NAADF_PACKED_BLOCK_WORDS, naadf_node_state

@group(3) @binding(5) var<storage, read_write> naadf_block_records: array<u32>;
@group(3) @binding(30) var<storage, read> naadf_build_slots: array<u32>;

var<workgroup> cached_skip: array<u32, 64>;
var<workgroup> cached_next_skip: array<u32, 64>;
var<workgroup> cached_occupied: array<u32, 64>;

@compute @workgroup_size(64)
fn build_naadf_bounds(
    @builtin(workgroup_id) group_id: vec3<u32>,
    @builtin(local_invocation_index) local_index: u32,
) {
    let chunk_index = naadf_build_slots[group_id.x];
    let block_index = chunk_index * NAADF_BLOCKS_PER_CHUNK + local_index;
    let base = block_index * NAADF_PACKED_BLOCK_WORDS;
    let node = naadf_block_records[base + 0u];
    let occupied = select(0u, 1u, naadf_node_state(node) != NAADF_NODE_UNIFORM_EMPTY);
    cached_skip[local_index] = 0u;
    cached_occupied[local_index] = occupied;
    workgroupBarrier();

    // Upstream ComputeBounds4 syncs after X, Y, and Z inside each of 3 passes.
    for (var pass_index = 0u; pass_index < 3u; pass_index = pass_index + 1u) {
        var cur = cached_skip[local_index];
        let pos = naadf_unflatten4(local_index);
        if occupied == 0u {
            if pos.x > 0u {
                cur = naadf_try_extend(cur, local_index - 1u, 0u, 0x3du);
            }
            if pos.x + 1u < 4u {
                cur = naadf_try_extend(cur, local_index + 1u, 2u, 0x3eu);
            }
        }
        cached_next_skip[local_index] = cur;
        workgroupBarrier();
        cached_skip[local_index] = cached_next_skip[local_index];
        workgroupBarrier();

        cur = cached_skip[local_index];
        if occupied == 0u {
            if pos.y > 0u {
                cur = naadf_try_extend(cur, local_index - 4u, 4u, 0x37u);
            }
            if pos.y + 1u < 4u {
                cur = naadf_try_extend(cur, local_index + 4u, 6u, 0x3bu);
            }
        }
        cached_next_skip[local_index] = cur;
        workgroupBarrier();
        cached_skip[local_index] = cached_next_skip[local_index];
        workgroupBarrier();

        cur = cached_skip[local_index];
        if occupied == 0u {
            if pos.z > 0u {
                cur = naadf_try_extend(cur, local_index - 16u, 8u, 0x1fu);
            }
            if pos.z + 1u < 4u {
                cur = naadf_try_extend(cur, local_index + 16u, 10u, 0x2fu);
            }
        }
        cached_next_skip[local_index] = cur;
        workgroupBarrier();
        cached_skip[local_index] = cached_next_skip[local_index];
        workgroupBarrier();
    }

    naadf_block_records[base + 5u] = cached_skip[local_index];
}

fn naadf_unflatten4(index: u32) -> vec3<u32> {
    return vec3<u32>(index % 4u, (index / 4u) % 4u, index / 16u);
}

fn naadf_try_extend(cur: u32, neighbour_index: u32, bound_offset: u32, mask: u32) -> u32 {
    if cached_occupied[neighbour_index] != 0u {
        return cur;
    }
    let neighbour = cached_skip[neighbour_index];
    if (naadf_matching_bounds_mask(neighbour, cur) & mask) != mask {
        return cur;
    }
    let field = (cur >> bound_offset) & 0x3u;
    if field >= 3u {
        return cur;
    }
    return cur + (1u << bound_offset);
}

fn naadf_matching_bounds_mask(neighbour: u32, cur: u32) -> u32 {
    var mask = 0u;
    mask = mask | (select(0u, 1u, ((neighbour >> 0u) & 0x3u) >= ((cur >> 0u) & 0x3u)) << 0u);
    mask = mask | (select(0u, 1u, ((neighbour >> 2u) & 0x3u) >= ((cur >> 2u) & 0x3u)) << 1u);
    mask = mask | (select(0u, 1u, ((neighbour >> 4u) & 0x3u) >= ((cur >> 4u) & 0x3u)) << 2u);
    mask = mask | (select(0u, 1u, ((neighbour >> 6u) & 0x3u) >= ((cur >> 6u) & 0x3u)) << 3u);
    mask = mask | (select(0u, 1u, ((neighbour >> 8u) & 0x3u) >= ((cur >> 8u) & 0x3u)) << 4u);
    mask = mask | (select(0u, 1u, ((neighbour >> 10u) & 0x3u) >= ((cur >> 10u) & 0x3u)) << 5u);
    return mask;
}
