#import "shaders/naadf/common.wgsl" NAADF_BLOCKS_PER_CHUNK, NAADF_MIP_CELLS_PER_CHUNK, NAADF_MIP_LEVEL_0_OFFSET, NAADF_NODE_CHILDREN, NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, NAADF_PACKED_BLOCK_WORDS, NAADF_VOXELS_PER_BLOCK_AXIS, NAADF_VOXELS_PER_CHUNK, naadf_make_node, naadf_make_traversal_record
#import "shaders/naadf/layout.wgsl" naadf_voxel_index_in_block, naadf_voxel_index_in_chunk

@group(3) @binding(0) var<storage, read_write> naadf_voxel_records: array<u32>;
@group(3) @binding(1) var<storage, read_write> naadf_material_records: array<u32>;
@group(3) @binding(4) var<storage, read> naadf_raw_voxel_records: array<u32>;
@group(3) @binding(5) var<storage, read_write> naadf_block_records: array<u32>;
@group(3) @binding(6) var<storage, read_write> naadf_mip_traversal_records: array<u32>;
@group(3) @binding(7) var<storage, read_write> naadf_mip_payload_records: array<u32>;
@group(3) @binding(30) var<storage, read> naadf_build_slots: array<u32>;

var<workgroup> cached_occupied: array<u32, 64>;
var<workgroup> cached_material: array<u32, 64>;
var<workgroup> cached_skip: array<u32, 64>;
var<workgroup> cached_next_skip: array<u32, 64>;

@compute @workgroup_size(64)
fn build_naadf_blocks(
    @builtin(workgroup_id) workgroup_id: vec3<u32>,
    @builtin(local_invocation_index) local_index: u32,
) {
    let build_index = workgroup_id.x / NAADF_BLOCKS_PER_CHUNK;
    let chunk_slot = naadf_build_slots[build_index];
    let block_index = workgroup_id.x % NAADF_BLOCKS_PER_CHUNK;
    let block_coord = vec3<u32>(
        block_index % 4u,
        (block_index / 4u) % 4u,
        block_index / 16u,
    );
    let block_local = naadf_unflatten4(local_index);
    let chunk_local = block_coord * vec3<u32>(NAADF_VOXELS_PER_BLOCK_AXIS) + block_local;
    let chunk_voxel_index = naadf_voxel_index_in_chunk(chunk_local);
    let raw_chunk_base = chunk_slot * NAADF_VOXELS_PER_CHUNK;
    let raw_record = naadf_raw_voxel_records[raw_chunk_base + chunk_voxel_index];

    cached_occupied[local_index] = select(0u, 1u, naadf_raw_voxel_occupied(raw_record));
    cached_material[local_index] = naadf_raw_voxel_material(raw_record);
    cached_skip[local_index] = 0u;
    workgroupBarrier();

    for (var pass_index = 0u; pass_index < 3u; pass_index = pass_index + 1u) {
        naadf_propagate_x_phase(local_index, block_local);
        naadf_propagate_y_phase(local_index, block_local);
        naadf_propagate_z_phase(local_index, block_local);
    }

    naadf_voxel_records[raw_chunk_base + chunk_voxel_index] = naadf_pack_voxel_record(
        cached_occupied[local_index] != 0u,
        cached_skip[local_index],
    );
    naadf_material_records[raw_chunk_base + chunk_voxel_index] = cached_material[local_index];
    let mip_base = chunk_slot * NAADF_MIP_CELLS_PER_CHUNK + NAADF_MIP_LEVEL_0_OFFSET;
    let mip_record_index = mip_base + chunk_voxel_index;
    naadf_mip_traversal_records[mip_record_index] = naadf_make_traversal_record(
        select(NAADF_NODE_UNIFORM_EMPTY, NAADF_NODE_UNIFORM_FULL, cached_occupied[local_index] != 0u),
        select(0u, 1u, cached_occupied[local_index] != 0u),
        false,
    );
    naadf_mip_payload_records[mip_record_index] = cached_material[local_index];

    if local_index == 0u {
        var occupied_count = 0u;
        var first_material = 0u;
        var uniform_material = true;
        var occupancy_low = 0u;
        var occupancy_high = 0u;
        var neg_x = NAADF_VOXELS_PER_BLOCK_AXIS;
        var pos_x = NAADF_VOXELS_PER_BLOCK_AXIS;
        var neg_y = NAADF_VOXELS_PER_BLOCK_AXIS;
        var pos_y = NAADF_VOXELS_PER_BLOCK_AXIS;
        var neg_z = NAADF_VOXELS_PER_BLOCK_AXIS;
        var pos_z = NAADF_VOXELS_PER_BLOCK_AXIS;

        for (var bit_index = 0u; bit_index < 64u; bit_index = bit_index + 1u) {
            if cached_occupied[bit_index] != 0u {
                let pos = naadf_unflatten4(bit_index);
                if bit_index < 32u {
                    occupancy_low = occupancy_low | (1u << bit_index);
                } else {
                    occupancy_high = occupancy_high | (1u << (bit_index - 32u));
                }
                neg_x = min(neg_x, pos.x);
                pos_x = min(pos_x, 3u - pos.x);
                neg_y = min(neg_y, pos.y);
                pos_y = min(pos_y, 3u - pos.y);
                neg_z = min(neg_z, pos.z);
                pos_z = min(pos_z, 3u - pos.z);
                if occupied_count == 0u {
                    first_material = cached_material[bit_index];
                } else if cached_material[bit_index] != first_material {
                    uniform_material = false;
                }
                occupied_count = occupied_count + 1u;
            }
        }

        var node = naadf_make_node(NAADF_NODE_CHILDREN, 0u);
        if occupied_count == 0u {
            node = naadf_make_node(NAADF_NODE_UNIFORM_EMPTY, 0u);
        } else if occupied_count == 64u && uniform_material {
            node = naadf_make_node(NAADF_NODE_UNIFORM_FULL, first_material);
        }
        if occupied_count == 64u {
            neg_x = 0u;
            pos_x = 0u;
            neg_y = 0u;
            pos_y = 0u;
            neg_z = 0u;
            pos_z = 0u;
        }

        let output_base = (chunk_slot * NAADF_BLOCKS_PER_CHUNK + block_index) * NAADF_PACKED_BLOCK_WORDS;
        naadf_block_records[output_base + 0u] = node;
        naadf_block_records[output_base + 1u] = naadf_pack_bounds_xy(neg_x, pos_x, neg_y, pos_y);
        naadf_block_records[output_base + 2u] = occupancy_low;
        naadf_block_records[output_base + 3u] = occupancy_high;
        naadf_block_records[output_base + 4u] = naadf_pack_bounds_z(neg_z, pos_z);
        // Filled by build_naadf_bounds after all blocks in the chunk have nodes.
        naadf_block_records[output_base + 5u] = 0u;
        naadf_block_records[output_base + 6u] = 0u;
        naadf_block_records[output_base + 7u] = 0u;
    }
}

fn naadf_propagate_x_phase(local_index: u32, pos: vec3<u32>) {
    var cur = cached_skip[local_index];
    if cached_occupied[local_index] == 0u {
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
}

fn naadf_propagate_y_phase(local_index: u32, pos: vec3<u32>) {
    var cur = cached_skip[local_index];
    if cached_occupied[local_index] == 0u {
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
}

fn naadf_propagate_z_phase(local_index: u32, pos: vec3<u32>) {
    var cur = cached_skip[local_index];
    if cached_occupied[local_index] == 0u {
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

fn naadf_try_extend(current: u32, neighbour_index: u32, bound_offset: u32, mask: u32) -> u32 {
    if cached_occupied[neighbour_index] != 0u {
        return current;
    }
    let neighbour = cached_skip[neighbour_index];
    if !naadf_matching_bounds_mask(neighbour, current, mask) {
        return current;
    }
    let value = (current >> bound_offset) & 0x3u;
    if value >= 3u {
        return current;
    }
    let clear_mask = ~(0x3u << bound_offset);
    return (current & clear_mask) | ((value + 1u) << bound_offset);
}

fn naadf_matching_bounds_mask(neighbour: u32, current: u32, mask: u32) -> bool {
    for (var axis = 0u; axis < 6u; axis = axis + 1u) {
        let offset = axis * 2u;
        if (mask & (1u << axis)) != 0u {
            if ((neighbour >> offset) & 0x3u) < ((current >> offset) & 0x3u) {
                return false;
            }
        }
    }
    return true;
}

fn naadf_unflatten4(index: u32) -> vec3<u32> {
    return vec3<u32>(index % 4u, (index / 4u) % 4u, index / 16u);
}

fn naadf_raw_voxel_occupied(record: u32) -> bool {
    return (record & 0x80000000u) != 0u;
}

fn naadf_raw_voxel_material(record: u32) -> u32 {
    return record & 0x0000ffffu;
}

fn naadf_pack_voxel_record(occupied: bool, directional_skip: u32) -> u32 {
    return select(0u, 0x80000000u, occupied) | (directional_skip & 0x00000fffu);
}

fn naadf_pack_bounds_xy(neg_x: u32, pos_x: u32, neg_y: u32, pos_y: u32) -> u32 {
    return neg_x | (pos_x << 8u) | (neg_y << 16u) | (pos_y << 24u);
}

fn naadf_pack_bounds_z(neg_z: u32, pos_z: u32) -> u32 {
    return neg_z | (pos_z << 8u);
}
