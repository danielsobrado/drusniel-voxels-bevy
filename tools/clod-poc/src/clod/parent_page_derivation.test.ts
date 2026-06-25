import { beforeAll, describe, expect, it } from "vitest";
import { initSimplifier } from "../simplify.js";
import type { ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import { assertNoInternalBorders } from "../validate.js";
import { boundsOf } from "./heightfield_leaf_source.js";
import { deriveParentPage, type ClodDerivationConfig } from "./parent_page_derivation.js";

const CONFIG: ClodDerivationConfig = {
  simplifyTargetRatio: 1,
  minParentSegments: 2,
  borderLockEpsilonM: 0.001,
  borderChainSearchBandM: 1,
  errorScale: 1,
};

describe("deriveParentPage", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("derives parent mesh data from child meshes instead of heightfield resampling", () => {
    const children = [
      childNode(0, 0, 11, 101, 3),
      childNode(1, 0, 12, 102, 5),
      childNode(0, 1, 13, 103, 7),
      childNode(1, 1, 14, 104, 9),
    ];

    const derived = deriveParentPage(1, 0, 0, children, CONFIG);
    const parent = derived.node;

    expect(parent.children).toEqual(children);
    expect(parent.errorWorld).toBeGreaterThanOrEqual(9);
    expect(derived.borderChainsChecked).toBe(4);
    expect(derived.internalBorderChecks).toBe(2);
    expect(derived.sourceTriangles).toBeGreaterThan(0);
    expect(derived.outputTriangles).toBeGreaterThan(0);
    expect([...parent.mesh.paintSlots].some((value) => value >= 11 && value <= 14)).toBe(true);
    expect([...parent.mesh.positions].some((value) => value >= 101 && value <= 104)).toBe(true);
    for (const value of parent.mesh.positions) expect(Number.isFinite(value)).toBe(true);
    for (const value of parent.mesh.normals) expect(Number.isFinite(value)).toBe(true);
    for (const value of parent.mesh.paintSlots) expect(Number.isFinite(value)).toBe(true);
    expect(() => assertNoInternalBorders(parent.mesh, parent.footprint)).not.toThrow();
  });
});

function childNode(nx: number, nz: number, sentinelMaterial: number, sentinelHeight: number, errorWorld: number): ClodPageNode {
  const footprint: PageFootprint = {
    minX: nx * 4,
    minZ: nz * 4,
    maxX: (nx + 1) * 4,
    maxZ: (nz + 1) * 4,
  };
  const mesh = childMesh(footprint, sentinelMaterial, sentinelHeight);
  return {
    id: `L0:${nx},${nz}`,
    level: 0,
    children: [],
    mesh,
    footprint,
    bounds: boundsOf(mesh),
    errorWorld,
    lowBenefit: false,
  };
}

function childMesh(footprint: PageFootprint, sentinelMaterial: number, sentinelHeight: number): PageMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const materials: number[] = [];
  for (let z = 0; z <= 2; z++) {
    for (let x = 0; x <= 2; x++) {
      const isInterior = x === 1 && z === 1;
      positions.push(
        footprint.minX + (x / 2) * (footprint.maxX - footprint.minX),
        isInterior ? sentinelHeight : 0,
        footprint.minZ + (z / 2) * (footprint.maxZ - footprint.minZ),
      );
      normals.push(0, 1, 0);
      materials.push(isInterior ? sentinelMaterial : 1);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < 2; z++) {
    for (let x = 0; x < 2; x++) {
      const a = z * 3 + x;
      const b = a + 1;
      const c = a + 3;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const nv = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    paintSlots: new Float32Array(materials),
    materialWeights: new Float32Array(nv * 4),
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}
