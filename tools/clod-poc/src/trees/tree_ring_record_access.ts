import { instanceIndex, storage } from "three/tsl";
import {
  TREE_RING_INSTANCE_VEC4S,
  treeRingRecordFieldIndex,
  type TreeRingRecordField,
} from "./tree_ring_placement.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

/** Read-only view of the GPU ring instance buffer, sized to the record stride. */
export function treeRingRecords(cell: any, capacity: number): TslNode {
  return storage(cell, "vec4", capacity * TREE_RING_INSTANCE_VEC4S).toReadOnly();
}

/** The vec4 node for one named field of the current instance's record. Applying the
 *  per-record stride here — and only here — is what keeps every material reading the field
 *  the compute writer actually wrote. */
export function treeRingRecordField(records: TslNode, field: TreeRingRecordField): TslNode {
  const base: TslNode = instanceIndex.mul(TREE_RING_INSTANCE_VEC4S);
  const offset = treeRingRecordFieldIndex(field);
  return records.element(offset === 0 ? base : base.add(offset));
}
