/** The vec4 fields the GPU ring writes per tree record, in the order `write_tree_record`
 *  emits them (tree_ring.compute.wgsl). This ordered list is the single source of truth for
 *  the record layout: the per-record stride, the TS readers' field offsets, and the WGSL
 *  `TREE_INSTANCE_VEC4S` constant are all derived from it. A reader that kept a stale stride
 *  after this record widened caused the tree blink; route reads through
 *  tree_ring_record_access.ts so the stride is applied in exactly one place. */
export const TREE_RING_RECORD_FIELDS = [
  "positionScale",
  "rotationNormalY",
  "identity",
  "morphology0",
  "morphology1",
  "morphology2",
] as const;

export type TreeRingRecordField = (typeof TREE_RING_RECORD_FIELDS)[number];

/** vec4 values per tree record — the stride every reader and the WGSL writer must agree on. */
export const TREE_RING_INSTANCE_VEC4S = TREE_RING_RECORD_FIELDS.length;

/** The vec4 offset of a named field within a tree record. */
export function treeRingRecordFieldIndex(field: TreeRingRecordField): number {
  return TREE_RING_RECORD_FIELDS.indexOf(field);
}

export const TREE_RING_CELL_SIZE_M = 3.4;
export const TREE_RING_JITTER_X_SALT = 1103;
export const TREE_RING_JITTER_Z_SALT = 1200;
export const TREE_RING_YAW_SALT = 701;
