import { beforeAll, describe, expect, it } from "vitest";
import phase1ConfigText from "../../config/phase1_terrain.yaml?raw";
import { initSimplifier } from "./simplify.js";
import { buildHeightfieldLeafNodes } from "./heightfield_leaf_source.js";
import { buildDerivedClodTree } from "./page_tree_builder.js";
import { parsePhase1Config } from "../phase1/phase1_config.js";
import { generatePhase1Heightfield } from "../phase1/terrain_synthesis.js";
import { HeightfieldSampler } from "../phase1/heightfield_sampler.js";

describe("buildDerivedClodTree", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("builds leaves and parent nodes from child references only", () => {
    const config = parsePhase1Config(phase1ConfigText);
    const field = generatePhase1Heightfield(1, config, 64);
    const leaves = buildHeightfieldLeafNodes(4, new HeightfieldSampler(field), config);
    const tree = buildDerivedClodTree(leaves.leafNodes, leaves.worldPages, {
      ...config.clod,
      maxParentLevel: config.clod.maxParentLevel,
    });

    expect(tree.leafNodes).toBe(16);
    expect(tree.parentNodes).toBeGreaterThan(0);
    expect(tree.maxLevel).toBeGreaterThanOrEqual(1);
    expect(tree.borderChainsChecked).toBeGreaterThan(0);
    expect(tree.internalBorderChecks).toBeGreaterThan(0);
    const parent = tree.nodesByLevel.get(1)?.[0];
    expect(parent?.children.length).toBeGreaterThan(0);
    expect(parent?.children[0]).toBe(leaves.leafNodes[0]);
    expect(parent?.errorWorld).toBeGreaterThanOrEqual(Math.max(...parent!.children.map((child) => child?.errorWorld ?? 0)));
    for (const nodes of tree.nodesByLevel.values()) {
      for (const node of nodes) {
        for (const value of node.mesh.positions) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
