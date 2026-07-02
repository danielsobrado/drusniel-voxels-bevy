import { describe, expect, it } from "vitest";
import { treeRingUsesFarMaterial } from "./tree_ring_far_node_material.js";

describe("tree ring far material policy", () => {
  it("only uses the cheap far material for far and unbaked impostor ring draws", () => {
    expect(treeRingUsesFarMaterial("near")).toBe(false);
    expect(treeRingUsesFarMaterial("mid")).toBe(false);
    expect(treeRingUsesFarMaterial("far")).toBe(true);
    expect(treeRingUsesFarMaterial("impostor")).toBe(true);
  });
});
