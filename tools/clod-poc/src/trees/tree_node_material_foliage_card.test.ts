import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import {
  createTreeNodeMaterialHandle,
  treeFoliageCardCoverageAt,
} from "./tree_node_material.js";

describe("tree WebGPU foliage card cutout", () => {
  it("packs card-retention inputs before the fragment stage", () => {
    const source = readFileSync(new URL("./tree_node_material.ts", import.meta.url), "utf8");
    expect(source).toContain("treeCpuCardInputs");
    expect(source).toContain("treeRingCardInputs");
    expect(source).toContain("vec3(aFoliageCard, deformation.foliageRetention, aBranchPhase)");
  });

  it("keeps the leaflet center and removes square card corners", () => {
    expect(treeFoliageCardCoverageAt(0.25, 0.25)).toBeCloseTo(1);
    expect(treeFoliageCardCoverageAt(0.01, 0.01)).toBe(0);
    expect(treeFoliageCardCoverageAt(0.49, 0.49)).toBe(0);
  });

  it("shares the material mask with the depth prepass", () => {
    const handle = createTreeNodeMaterialHandle(DEFAULT_TREE_SETTINGS);
    try {
      const material = handle.regularMaterial as unknown as { maskNode?: unknown };
      const prepass = handle.prepassNodesFor?.("near");
      expect(material.maskNode).toBeTruthy();
      expect(prepass?.maskNode).toBe(material.maskNode);
    } finally {
      handle.dispose();
    }
  });
});
