import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TREE_RING_CELL_SIZE_M,
  TREE_RING_JITTER_X_SALT,
  TREE_RING_JITTER_Z_SALT,
  TREE_RING_YAW_SALT,
} from "./index.js";

describe("tree ring placement constants", () => {
  it("reads canonical placement from the shared 96-byte GPU record", () => {
    const source = readFileSync(new URL("./tree_node_material.ts", import.meta.url), "utf8");

    expect(TREE_RING_CELL_SIZE_M).toBe(3.4);
    expect(TREE_RING_JITTER_X_SALT).toBe(1103);
    expect(TREE_RING_JITTER_Z_SALT).toBe(1200);
    expect(TREE_RING_YAW_SALT).toBe(701);
    expect(source).toContain("treeMorphologyRecordNodes(buffers)");
    expect(source).toContain("record.positionScale.xz");
    expect(source).toContain("record.rotationNormalY.x");
  });

  it("reads the same canonical placement record in the impostor material", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("treeMorphologyRecordNodes(buffers)");
    expect(source).toContain("record.positionScale.xz");
    expect(source).toContain("record.rotationNormalY.x");
  });
});
