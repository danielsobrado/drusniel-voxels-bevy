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
