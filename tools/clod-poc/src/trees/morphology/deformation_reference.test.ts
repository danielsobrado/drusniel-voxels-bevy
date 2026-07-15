import { describe, expect, it } from "vitest";
import { deformTreeVertexReference } from "./deformation_reference.js";
import type { TreeInstanceMorphology, TreeVertexMorphologyAttributes } from "./types.js";

const neutral: TreeInstanceMorphology = {
  age01: 0.5,
  leanX: 0,
  leanZ: 0,
  crownBiasX: 0,
  crownBiasZ: 0,
  crownWidth: 1,
  crownFlattening: 1,
  branchDroop: 0,
  foliageDensity: 1,
  health01: 1,
  rootFlare: 1,
  stiffness: 1,
};

function attributes(overrides: Partial<TreeVertexMorphologyAttributes> = {}): TreeVertexMorphologyAttributes {
  return {
    treeHeight01: 0.5,
    treeRadial01: 0.5,
    treeBranchLevel: 0,
    treeBranchPhase: 0.25,
    treeRootMask: 0,
    treeFoliageMask: 0,
    treeFoliageCard: 0,
    ...overrides,
  };
}

describe("tree morphology deformation reference", () => {
  it("keeps the root contact planted", () => {
    const result = deformTreeVertexReference({
      position: [0, 0, 0], normal: [0, 1, 0], attributes: attributes({ treeHeight01: 0, treeRootMask: 1 }),
      morphology: { ...neutral, leanX: 0.22, crownBiasX: 0.35, branchDroop: 0.32, rootFlare: 1.35 },
      treeHeight: 20, crownRadius: 5, crownStart01: 0.4,
    });
    expect(result.position).toEqual([0, 0, 0]);
  });

  it("bends the top more than the middle and leaves the base fixed", () => {
    const morphology = { ...neutral, leanX: 0.2 };
    const base = deformTreeVertexReference({ position: [0, 0, 0], normal: [1, 0, 0], attributes: attributes({ treeHeight01: 0 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    const middle = deformTreeVertexReference({ position: [0, 10, 0], normal: [1, 0, 0], attributes: attributes({ treeHeight01: 0.5 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    const top = deformTreeVertexReference({ position: [0, 20, 0], normal: [1, 0, 0], attributes: attributes({ treeHeight01: 1 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    expect(base.position[0]).toBe(0);
    expect(top.position[0]).toBeGreaterThan(middle.position[0] * 2);
    expect(Math.hypot(...top.normal)).toBeCloseTo(1, 6);
    expect(top.normal[1]).toBeLessThan(0);
  });

  it("applies crown width to crown vertices without moving the trunk base", () => {
    const morphology = { ...neutral, crownWidth: 1.18 };
    const trunk = deformTreeVertexReference({ position: [1, 0, 0], normal: [1, 0, 0], attributes: attributes({ treeHeight01: 0 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    const crown = deformTreeVertexReference({ position: [1, 18, 0], normal: [1, 0, 0], attributes: attributes({ treeHeight01: 0.9 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    expect(trunk.position[0]).toBeCloseTo(0.95, 6);
    expect(crown.position[0]).toBeGreaterThan(1.1);
  });

  it("increases droop with branch level and height", () => {
    const morphology = { ...neutral, branchDroop: 0.2 };
    const low = deformTreeVertexReference({ position: [2, 5, 0], normal: [0, 1, 0], attributes: attributes({ treeHeight01: 0.25, treeBranchLevel: 0.25 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    const high = deformTreeVertexReference({ position: [2, 15, 0], normal: [0, 1, 0], attributes: attributes({ treeHeight01: 0.75, treeBranchLevel: 1 }), morphology, treeHeight: 20, crownRadius: 5, crownStart01: 0.4 });
    expect(15 - high.position[1]).toBeGreaterThan(5 - low.position[1]);
  });
});
