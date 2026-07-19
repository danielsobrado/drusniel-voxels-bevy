import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TREE_SPECIES } from "./tree_config.js";
import {
  TREE_IMPOSTOR_FOLIAGE_TRANSMISSION,
  TREE_IMPOSTOR_HDR_MAX,
  treeImpostorFoliageTransmissionWeight,
} from "./tree_impostor_lighting.js";

describe("tree impostor lighting parity", () => {
  it("matches the mesh-tree foliage transmission and HDR contracts", () => {
    expect(TREE_IMPOSTOR_FOLIAGE_TRANSMISSION).toBe(0.28);
    expect(TREE_IMPOSTOR_HDR_MAX).toBe(4.0);
  });

  it("disables leaf transmission for the bare dead-tree species", () => {
    for (const species of TREE_SPECIES) {
      expect(treeImpostorFoliageTransmissionWeight(species)).toBe(species === "dead" ? 0 : 1);
    }
  });

  it("uses the shared scene-style sun wrap in the GPU-ring material", () => {
    const source = readFileSync(
      new URL("./tree_ring_impostor_node_material.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import { styleWrappedSunTerm } from "../style/scene_style.js"');
    expect(source).toContain("styleWrappedSunTerm(dot(n, uLight))");
    expect(source).toContain("treeImpostorFoliageTransmissionWeight(atlas.species)");
    expect(source).toContain(".mul(TREE_IMPOSTOR_FOLIAGE_TRANSMISSION)");
    expect(source).toContain("TREE_IMPOSTOR_HDR_MAX");
    expect(source).not.toContain("TREE_RING_IMPOSTOR_SUN_MAX");
    expect(source).not.toContain("TREE_RING_IMPOSTOR_LEAF_TRANSMISSION");
  });
});
