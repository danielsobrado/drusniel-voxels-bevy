#import "shaders/naadf/common.wgsl" NAADF_PACKED_BLOCK_WORDS, NAADF_VOXELS_PER_BLOCK_AXIS

@group(3) @binding(5) var<storage, read_write> naadf_block_records: array<u32>;

@compute @workgroup_size(64)
fn build_naadf_bounds(@builtin(global_invocation_id) id: vec3<u32>) {
    let block_index = id.x;
    let base = block_index * NAADF_PACKED_BLOCK_WORDS;
    let occupancy_low = naadf_block_records[base + 2u];
    let occupancy_high = naadf_block_records[base + 3u];

    var neg_x = NAADF_VOXELS_PER_BLOCK_AXIS;
    var pos_x = NAADF_VOXELS_PER_BLOCK_AXIS;
    var neg_y = NAADF_VOXELS_PER_BLOCK_AXIS;
    var pos_y = NAADF_VOXELS_PER_BLOCK_AXIS;
    var neg_z = NAADF_VOXELS_PER_BLOCK_AXIS;
    var pos_z = NAADF_VOXELS_PER_BLOCK_AXIS;

    for (var bit = 0u; bit < 64u; bit = bit + 1u) {
        if naadf_mask_bit_is_set(occupancy_low, occupancy_high, bit) {
            let x = bit % 4u;
            let y = (bit / 4u) % 4u;
            let z = bit / 16u;
            neg_x = min(neg_x, x);
            pos_x = min(pos_x, 3u - x);
            neg_y = min(neg_y, y);
            pos_y = min(pos_y, 3u - y);
            neg_z = min(neg_z, z);
            pos_z = min(pos_z, 3u - z);
        }
    }

    naadf_block_records[base + 1u] = naadf_pack_bounds_xy(neg_x, pos_x, neg_y, pos_y);
    naadf_block_records[base + 4u] = naadf_pack_bounds_z(neg_z, pos_z);
}

fn naadf_mask_bit_is_set(low: u32, high: u32, bit: u32) -> bool {
    if bit < 32u {
        return (low & (1u << bit)) != 0u;
    }
    return (high & (1u << (bit - 32u))) != 0u;
}

fn naadf_pack_bounds_xy(neg_x: u32, pos_x: u32, neg_y: u32, pos_y: u32) -> u32 {
    return neg_x | (pos_x << 8u) | (neg_y << 16u) | (pos_y << 24u);
}

fn naadf_pack_bounds_z(neg_z: u32, pos_z: u32) -> u32 {
    return neg_z | (pos_z << 8u);
}
