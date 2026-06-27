import { describe, expect, it } from "vitest";
import type { ShadowMeshAsset, ShadowMeshSet } from "./shadow_mesh.js";
import {
  buildShadowProxyViewerModel,
  shadowProxyViewerSummaryLine,
} from "./shadow_proxy_overlay.js";

function asset(overrides: Partial<ShadowMeshAsset> = {}): ShadowMeshAsset {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 0, 1,
    1, 0, 1,
  ]);
  const indices = new Uint32Array([0, 2, 1, 1, 2, 3]);
  return {
    nodeId: "L1:0,0",
    level: 1,
    shadowMeshId: "shadow:L1:0,0",
    visualMeshId: "visual:L1:0,0",
    sourceTriangleCount: 100,
    triangleCount: 35,
    reductionRatio: 0.35,
    footprint: { minX: 0, minZ: 0, maxX: 64, maxZ: 64 },
    bounds: { min: [0, 0, 0], max: [64, 10, 64] },
    mesh: {
      positions,
      indices,
      bounds: { min: [0, 0, 0], max: [64, 10, 64] },
      sourceTriangleCount: 100,
      triangleCount: 35,
      reductionRatio: 0.35,
    },
    ...overrides,
  };
}

function meshSet(meshes: ShadowMeshAsset[]): ShadowMeshSet {
  const sourceTriangles = meshes.reduce((sum, mesh) => sum + mesh.sourceTriangleCount, 0);
  const shadowTriangles = meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0);
  const savedTriangles = Math.max(0, sourceTriangles - shadowTriangles);
  return {
    version: 1,
    generatedBy: "clod-poc-shadow-mesh",
    meshes,
    totals: {
      shadowMeshCount: meshes.length,
      sourceTriangles,
      shadowTriangles,
      savedTriangles,
      savingsRatio: sourceTriangles > 0 ? savedTriangles / sourceTriangles : 0,
    },
  };
}

describe("buildShadowProxyViewerModel", () => {
  it("creates sorted viewer mesh entries from generated proxy assets", () => {
    const model = buildShadowProxyViewerModel(meshSet([
      asset({ nodeId: "L2:1,0", level: 2, shadowMeshId: "shadow:L2:1,0" }),
      asset({ nodeId: "L1:0,0", level: 1, shadowMeshId: "shadow:L1:0,0" }),
    ]), {
      wireframe: false,
      showBounds: true,
      opacity: 0.4,
    });

    expect(model.meshes.map((mesh) => mesh.nodeId)).toEqual(["L1:0,0", "L2:1,0"]);
    expect(model.meshes[0].policy).toBe("ClodShadowMesh");
    expect(model.meshes[0].wireframe).toBe(false);
    expect(model.meshes[0].showBounds).toBe(true);
    expect(model.meshes[0].opacity).toBe(0.4);
    expect(model.meshes[0].positions).toBeInstanceOf(Float32Array);
    expect(model.meshes[0].indices).toBeInstanceOf(Uint32Array);
  });

  it("reports aggregate source/proxy triangle savings", () => {
    const model = buildShadowProxyViewerModel(meshSet([
      asset({ sourceTriangleCount: 100, triangleCount: 35, reductionRatio: 0.35 }),
      asset({
        nodeId: "L1:1,0",
        shadowMeshId: "shadow:L1:1,0",
        sourceTriangleCount: 50,
        triangleCount: 20,
        reductionRatio: 0.4,
        mesh: {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          bounds: { min: [0, 0, 0], max: [1, 0, 1] },
          sourceTriangleCount: 50,
          triangleCount: 20,
          reductionRatio: 0.4,
        },
      }),
    ]));

    expect(model.summary.meshCount).toBe(2);
    expect(model.summary.sourceTriangles).toBe(150);
    expect(model.summary.proxyTriangles).toBe(55);
    expect(model.summary.savedTriangles).toBe(95);
    expect(model.summary.savingsRatio).toBeCloseTo(95 / 150);
    expect(model.summary.minReductionRatio).toBeCloseTo(0.35);
    expect(model.summary.maxReductionRatio).toBeCloseTo(0.4);
  });

  it("returns no meshes when disabled", () => {
    const model = buildShadowProxyViewerModel(meshSet([asset()]), { mode: "off" });

    expect(model.meshes).toEqual([]);
    expect(model.summary.mode).toBe("off");
    expect(model.summary.meshCount).toBe(0);
    expect(shadowProxyViewerSummaryLine(model.summary)).toBe("proxy view: off");
  });
});

describe("shadowProxyViewerSummaryLine", () => {
  it("formats HUD-ready proxy statistics", () => {
    const model = buildShadowProxyViewerModel(meshSet([
      asset({ sourceTriangleCount: 200, triangleCount: 50 }),
    ]));

    expect(shadowProxyViewerSummaryLine(model.summary)).toBe(
      "proxy view: meshes 1 source 200 tris proxy 50 tris saved 75.0% ratio 0.25-0.25",
    );
  });
});
