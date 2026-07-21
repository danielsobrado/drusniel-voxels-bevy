/** vec4 values the GPU ring writes per tree record (`TREE_INSTANCE_VEC4S` in
 *  tree_ring.compute.wgsl): position_scale, rotation_normal_y, identity, morphology0..2.
 *  Every reader of the ring instance buffer must index with this stride. */
export const TREE_RING_INSTANCE_VEC4S = 6;

export const TREE_RING_CELL_SIZE_M = 3.4;
export const TREE_RING_JITTER_X_SALT = 1103;
export const TREE_RING_JITTER_Z_SALT = 1200;
export const TREE_RING_YAW_SALT = 701;
