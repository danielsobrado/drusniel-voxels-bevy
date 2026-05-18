const NAADF_VOXELS_PER_BLOCK_AXIS: u32 = 4u;
const NAADF_BLOCKS_PER_CHUNK_AXIS: u32 = 4u;
const NAADF_VOXELS_PER_CHUNK_AXIS: u32 = 16u;
const NAADF_VOXELS_PER_BLOCK: u32 = 64u;
const NAADF_BLOCKS_PER_CHUNK: u32 = 64u;
const NAADF_VOXELS_PER_CHUNK: u32 = 4096u;

const NAADF_NODE_STATE_SHIFT: u32 = 30u;
const NAADF_NODE_PAYLOAD_MASK: u32 = 0x3fffffffu;

const NAADF_NODE_UNIFORM_EMPTY: u32 = 0u;
const NAADF_NODE_UNIFORM_FULL: u32 = 1u;
const NAADF_NODE_CHILDREN: u32 = 2u;
const NAADF_NODE_RESERVED: u32 = 3u;

const NAADF_CHUNK_BOUND_OFFSET_NEG_X: u32 = 0u;
const NAADF_CHUNK_BOUND_OFFSET_POS_X: u32 = 5u;
const NAADF_CHUNK_BOUND_OFFSET_NEG_Y: u32 = 10u;
const NAADF_CHUNK_BOUND_OFFSET_POS_Y: u32 = 15u;
const NAADF_CHUNK_BOUND_OFFSET_NEG_Z: u32 = 20u;
const NAADF_CHUNK_BOUND_OFFSET_POS_Z: u32 = 25u;
const NAADF_CHUNK_BOUND_FIELD_MASK: u32 = 0x1fu;

const NAADF_VOXEL_RECORD_BYTES: u32 = 4u;
const NAADF_RAW_VOXEL_RECORD_BYTES: u32 = 4u;
const NAADF_MATERIAL_RECORD_BYTES: u32 = 4u;
const NAADF_BLOCK_RECORD_BYTES: u32 = 32u;
const NAADF_CHUNK_RECORD_BYTES: u32 = 32u;
const NAADF_PACKED_BLOCK_WORDS: u32 = 8u;
const NAADF_PACKED_CHUNK_WORDS: u32 = 8u;
const NAADF_MIP_LEVEL_COUNT: u32 = 5u;
const NAADF_MIP_LEVEL_0_AXIS: u32 = 16u;
const NAADF_MIP_LEVEL_1_AXIS: u32 = 8u;
const NAADF_MIP_LEVEL_2_AXIS: u32 = 4u;
const NAADF_MIP_LEVEL_3_AXIS: u32 = 2u;
const NAADF_MIP_LEVEL_4_AXIS: u32 = 1u;
const NAADF_MIP_LEVEL_0_OFFSET: u32 = 0u;
const NAADF_MIP_LEVEL_1_OFFSET: u32 = 4096u;
const NAADF_MIP_LEVEL_2_OFFSET: u32 = 4608u;
const NAADF_MIP_LEVEL_3_OFFSET: u32 = 4672u;
const NAADF_MIP_LEVEL_4_OFFSET: u32 = 4680u;
const NAADF_MIP_CELLS_PER_CHUNK: u32 = 4681u;
const NAADF_TRAVERSAL_RECORD_STATE_SHIFT: u32 = 30u;
const NAADF_TRAVERSAL_RECORD_CHILD_MASK_MASK: u32 = 0xffu;
const NAADF_TRAVERSAL_RECORD_THIN_OR_HOLE_BIT: u32 = 0x20000000u;
const NAADF_PAYLOAD_RECORD_MATERIAL_MASK: u32 = 0x0000ffffu;
const NAADF_MIP_BOUND_OFFSET_NEG_X: u32 = 0u;
const NAADF_MIP_BOUND_OFFSET_POS_X: u32 = 5u;
const NAADF_MIP_BOUND_OFFSET_NEG_Y: u32 = 10u;
const NAADF_MIP_BOUND_OFFSET_POS_Y: u32 = 15u;
const NAADF_MIP_BOUND_OFFSET_NEG_Z: u32 = 20u;
const NAADF_MIP_BOUND_OFFSET_POS_Z: u32 = 25u;
const NAADF_MIP_BOUND_FIELD_MASK: u32 = 0x1fu;

fn naadf_node_state(node: u32) -> u32 {
    return node >> NAADF_NODE_STATE_SHIFT;
}

fn naadf_node_payload(node: u32) -> u32 {
    return node & NAADF_NODE_PAYLOAD_MASK;
}

fn naadf_make_node(state: u32, payload: u32) -> u32 {
    return (state << NAADF_NODE_STATE_SHIFT) | (payload & NAADF_NODE_PAYLOAD_MASK);
}

fn naadf_node_is_occupied_uniform(node: u32) -> bool {
    return naadf_node_state(node) == NAADF_NODE_UNIFORM_FULL;
}

fn naadf_make_traversal_record(state: u32, child_mask: u32, thin_or_hole: bool) -> u32 {
    return (state << NAADF_TRAVERSAL_RECORD_STATE_SHIFT) |
        (child_mask & NAADF_TRAVERSAL_RECORD_CHILD_MASK_MASK) |
        select(0u, NAADF_TRAVERSAL_RECORD_THIN_OR_HOLE_BIT, thin_or_hole);
}

fn naadf_traversal_state(record: u32) -> u32 {
    return record >> NAADF_TRAVERSAL_RECORD_STATE_SHIFT;
}

fn naadf_traversal_child_mask(record: u32) -> u32 {
    return record & NAADF_TRAVERSAL_RECORD_CHILD_MASK_MASK;
}

fn naadf_traversal_thin_or_hole(record: u32) -> bool {
    return (record & NAADF_TRAVERSAL_RECORD_THIN_OR_HOLE_BIT) != 0u;
}

fn naadf_payload_material_id(record: u32) -> u32 {
    return record & NAADF_PAYLOAD_RECORD_MATERIAL_MASK;
}

fn naadf_make_mip_bounds_record(
    neg_x: u32,
    pos_x: u32,
    neg_y: u32,
    pos_y: u32,
    neg_z: u32,
    pos_z: u32,
) -> u32 {
    return ((neg_x & NAADF_MIP_BOUND_FIELD_MASK) << NAADF_MIP_BOUND_OFFSET_NEG_X) |
        ((pos_x & NAADF_MIP_BOUND_FIELD_MASK) << NAADF_MIP_BOUND_OFFSET_POS_X) |
        ((neg_y & NAADF_MIP_BOUND_FIELD_MASK) << NAADF_MIP_BOUND_OFFSET_NEG_Y) |
        ((pos_y & NAADF_MIP_BOUND_FIELD_MASK) << NAADF_MIP_BOUND_OFFSET_POS_Y) |
        ((neg_z & NAADF_MIP_BOUND_FIELD_MASK) << NAADF_MIP_BOUND_OFFSET_NEG_Z) |
        ((pos_z & NAADF_MIP_BOUND_FIELD_MASK) << NAADF_MIP_BOUND_OFFSET_POS_Z);
}
