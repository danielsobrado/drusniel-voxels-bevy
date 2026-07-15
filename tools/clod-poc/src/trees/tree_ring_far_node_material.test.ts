import { describe, expect, it } from "vitest";
import source from "./tree_ring_far_node_material.ts?raw";
import { treeRingUsesFarMaterial } from "./tree_ring_far_node_material.js";

describe("tree ring far material policy", () => {
  it("only uses the cheap far material for far and unbaked impostor ring draws", () => {
    expect(treeRingUsesFarMaterial("near")).toBe(false);
    expect(treeRingUsesFarMaterial("mid")).toBe(false);
    expect(treeRingUsesFarMaterial("far")).toBe(true);
    expect(treeRingUsesFarMaterial("impostor")).toBe(true);
  });

  it("retains foliage with the same stable tree identity as the detailed ring material", () => {
    expect(source).toContain("treeFoliageCardKeep(");
    expect(source).toContain("floatBitsToUint(record.identityBits.zw)");
  });
});
