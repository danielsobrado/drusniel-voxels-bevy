import { describe, expect, it } from "vitest";
import {
  TREE_RING_INSTANCE_VEC4S,
  TREE_RING_RECORD_FIELDS,
  treeRingRecordFieldIndex,
} from "./tree_ring_placement.js";
import { TREE_GPU_RING_INSTANCE_VEC4S } from "./tree_system_gpu_ring_draw.js";

describe("tree ring record layout (single source of truth)", () => {
  it("derives the per-record stride from the field list", () => {
    expect(TREE_RING_INSTANCE_VEC4S).toBe(TREE_RING_RECORD_FIELDS.length);
    expect(TREE_RING_INSTANCE_VEC4S).toBe(6);
  });

  it("maps every named field to its own contiguous vec4 offset", () => {
    const offsets = TREE_RING_RECORD_FIELDS.map((field) => treeRingRecordFieldIndex(field));
    expect(offsets).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(offsets).size).toBe(TREE_RING_RECORD_FIELDS.length);
  });

  it("aliases the buffer-sizing stride to the record stride so they cannot diverge", () => {
    expect(TREE_GPU_RING_INSTANCE_VEC4S).toBe(TREE_RING_INSTANCE_VEC4S);
  });
});
