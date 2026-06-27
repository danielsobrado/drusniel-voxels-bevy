import { describe, expect, it } from "vitest";
import type { ClodPageNode, PageMesh } from "./types.js";
import type { ShadowManifest, ShadowManifestEntry } from "./shadow_manifest.js";
import {
  buildShadowMeshFromPageMesh,
  buildShadowMeshSet,
  computeShadowMeshBounds,
  pageMeshTriangleCount,
  serializeShadowMeshSet,
} from "./shadow_mesh.js";

function gridMesh(cellsX: number, cellsZ: number): PageMesh {
  const positions: number[] = [];
  for (let z = 0; z <= cellsZ; z++) {
    for (let x = 0; x <= cellsX; x++) {
      positions.push(x, (x + z) % 3, z);
    }
  }

  const vertex = (x: number, z: number) => z * (cellsX + 1) + x;
  const indices: number[] = [];
  for (let z = 0; z < cellsZ; z++) {
    for (let x = 0; x < cellsX; x++) {
      const a = vertex(x, z);
      const b = vertex(x + 1, z);
      const c = vertex(x, z + 1);
      const d = vertex(x + 1, z + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    paintSlots: new Float32Array(((cellsX + 1) * (cellsZ + 1))),
    materialWeights: new Float32Array(((cellsX + 1) * (cellsZ + 1)) * 4),
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}

function node(
  id: string,
  level: number,
  mesh: PageMesh,
  children: ClodPageNode[] = [],
): ClodPageNode {
  return {
    id,
    level,
    children,
    mesh,
    footprint: { minX: 0, minZ: 0, maxX: 8, maxZ: 8 },
    bounds: { center: [4, 1, 4], radius: 6, minY: 0, maxY: 2 },
    errorWorld: level,
    lowBenefit: false,
  };
}

function entry(overrides: Partial<ShadowManifestEntry>): ShadowManifestEntry {
  return {
    nodeId: "L1:0,0",
    level: 1,
    childIds: [],
    visualMeshId: "visual:L1:0,0",
    shadowMeshId: "shadow:L1:0,0",
    policy: "ClodShadowMesh",
    reason: "proxy",
    distance: 96,
    errorPx: 1.5,
    triangleCount: 128,
    shadowTriangleBudget: 45,
    footprint: { minX: 0, minZ: 0, maxX: 8, maxZ: 8 },
    bounds: { center: [4, 1, 4], radius: 6 },
    ...overrides,
  };
}

function manifest(entries: ShadowManifestEntry[]): ShadowManifest {
  const visualPages = entries.filter((e) => e.policy === "VisualMesh").length;
  const proxyPages = entries.filter((e) => e.policy === "ClodShadowMesh").length;
  const noCastPages = entries.filter((e) => e.policy === "NoCast").length;
  return {
    version: 1,
    generatedBy: "clod-poc-shadow-manifest",
    entries,
    totals: {
      totalPages: entries.length,
      casterPages: visualPages + proxyPages,
      visualPages,
      proxyPages,
      noCastPages,
      visualTriangles: entries.reduce((sum, e) => sum + e.triangleCount, 0),
      shadowTrianglesBudgeted: entries.reduce((sum, e) => sum + e.shadowTriangleBudget, 0),
      maxCasterDistance: 96,
    },
  };
}

describe("pageMeshTriangleCount", () => {
  it("counts indexed triangles", () => {
    expect(pageMeshTriangleCount(gridMesh(4, 4))).toBe(32);
  });
});

describe("computeShadowMeshBounds", () => {
  it("computes position bounds", () => {
    const bounds = computeShadowMeshBounds(new Float32Array([
      -1, 2, 3,
      4, -2, 8,
      2, 7, -5,
    ]));
    expect(bounds.min).toEqual([-1, -2, -5]);
    expect(bounds.max).toEqual([4, 7, 8]);
  });
});

describe("buildShadowMeshFromPageMesh", () => {
  it("builds a compact positions + indices shadow mesh", () => {
    const source = gridMesh(8, 8);
    const proxy = buildShadowMeshFromPageMesh(source, {
      preserveBoundary: false,
      targetTriangleRatio: 0.25,
      minTriangles: 4,
    });

    expect(proxy.sourceTriangleCount).toBe(128);
    expect(proxy.triangleCount).toBeGreaterThan(0);
    expect(proxy.triangleCount).toBeLessThan(proxy.sourceTriangleCount);
    expect(proxy.indices.length).toBe(proxy.triangleCount * 3);
    expect(proxy.positions.length % 3).toBe(0);
    expect(proxy.reductionRatio).toBeCloseTo(proxy.triangleCount / proxy.sourceTriangleCount);
  });

  it("preserves page boundary extents by default", () => {
    const source = gridMesh(8, 8);
    const sourceBounds = computeShadowMeshBounds(source.positions);
    const proxy = buildShadowMeshFromPageMesh(source, {
      targetTriangleRatio: 0.05,
      minTriangles: 1,
      preserveBoundary: true,
    });

    expect(proxy.bounds.min[0]).toBe(sourceBounds.min[0]);
    expect(proxy.bounds.max[0]).toBe(sourceBounds.max[0]);
    expect(proxy.bounds.min[2]).toBe(sourceBounds.min[2]);
    expect(proxy.bounds.max[2]).toBe(sourceBounds.max[2]);
    expect(proxy.triangleCount).toBeLessThan(proxy.sourceTriangleCount);
  });
});

describe("buildShadowMeshSet", () => {
  it("generates meshes only for ClodShadowMesh manifest entries", () => {
    const proxyNode = node("L1:0,0", 1, gridMesh(8, 8));
    const visualNode = node("L0:0,0", 0, gridMesh(4, 4));
    const noneNode = node("L2:0,0", 2, gridMesh(2, 2));
    const root = node("root", 3, gridMesh(1, 1), [proxyNode, visualNode, noneNode]);
    const meshSet = buildShadowMeshSet([root], manifest([
      entry({ nodeId: "L1:0,0", policy: "ClodShadowMesh", shadowMeshId: "shadow:L1:0,0" }),
      entry({ nodeId: "L0:0,0", policy: "VisualMesh", shadowMeshId: "visual:L0:0,0" }),
      entry({ nodeId: "L2:0,0", policy: "NoCast", shadowMeshId: null }),
    ]), {
      targetTriangleRatio: 0.25,
      preserveBoundary: false,
    });

    expect(meshSet.generatedBy).toBe("clod-poc-shadow-mesh");
    expect(meshSet.meshes).toHaveLength(1);
    expect(meshSet.meshes[0].nodeId).toBe("L1:0,0");
    expect(meshSet.meshes[0].shadowMeshId).toBe("shadow:L1:0,0");
    expect(meshSet.totals.shadowMeshCount).toBe(1);
    expect(meshSet.totals.sourceTriangles).toBe(128);
    expect(meshSet.totals.shadowTriangles).toBeLessThan(128);
  });

  it("throws when the manifest references a missing node", () => {
    expect(() => buildShadowMeshSet([], manifest([
      entry({ nodeId: "missing", policy: "ClodShadowMesh", shadowMeshId: "shadow:missing" }),
    ]))).toThrow(/missing CLOD node/);
  });

  it("serializes typed arrays into JSON arrays", () => {
    const root = node("L1:0,0", 1, gridMesh(2, 2));
    const meshSet = buildShadowMeshSet([root], manifest([
      entry({ nodeId: "L1:0,0", policy: "ClodShadowMesh", shadowMeshId: "shadow:L1:0,0" }),
    ]));
    const json = JSON.parse(serializeShadowMeshSet(meshSet));

    expect(json.generatedBy).toBe("clod-poc-shadow-mesh");
    expect(Array.isArray(json.meshes[0].mesh.positions)).toBe(true);
    expect(Array.isArray(json.meshes[0].mesh.indices)).toBe(true);
  });
});
