import { describe, expect, it } from "vitest";
import type { ClodPageNode, PageMesh } from "./types.js";
import { DEFAULT_SHADOW_CUT_PARAMS, selectShadowCut, type ShadowCutParams } from "./shadow_clod.js";
import {
  buildShadowManifest,
  flattenClodNodes,
  meshTriangleCount,
  serializeShadowManifest,
} from "./shadow_manifest.js";

function mesh(triangles: number): PageMesh {
  return {
    positions: new Float32Array(triangles * 9),
    normals: new Float32Array(triangles * 9),
    paintSlots: new Float32Array(triangles * 3),
    materialWeights: new Float32Array(triangles * 3 * 4),
    materialWeightStride: 4,
    indices: new Uint32Array(triangles * 3),
  };
}

function node(
  id: string,
  level: number,
  minX: number,
  minZ: number,
  size: number,
  triangles: number,
  errorWorld: number,
  children: ClodPageNode[] = [],
): ClodPageNode {
  const center: [number, number, number] = [minX + size * 0.5, 0, minZ + size * 0.5];
  return {
    id,
    level,
    children,
    mesh: mesh(triangles),
    footprint: { minX, minZ, maxX: minX + size, maxZ: minZ + size },
    bounds: { center, radius: Math.hypot(size, size) * 0.5, minY: 0, maxY: 0 },
    errorWorld,
    lowBenefit: false,
  };
}

function world(): ClodPageNode[] {
  const a = node("L0:0,0", 0, 0, 0, 64, 100, 0);
  const b = node("L0:1,0", 0, 64, 0, 64, 100, 0);
  const c = node("L0:0,1", 0, 0, 64, 64, 100, 0);
  const d = node("L0:1,1", 0, 64, 64, 64, 100, 0);
  return [node("L1:0,0", 1, 0, 0, 128, 160, 2, [a, b, c, d])];
}

function params(overrides: Partial<ShadowCutParams> = {}): ShadowCutParams {
  return {
    ...DEFAULT_SHADOW_CUT_PARAMS,
    viewportH: 1080,
    fovY: Math.PI / 3,
    camPos: [32, 16, 32],
    ...overrides,
  };
}

describe("shadow manifest", () => {
  it("flattens the CLOD hierarchy deterministically", () => {
    expect(flattenClodNodes(world()).map((n) => n.id)).toEqual([
      "L1:0,0",
      "L0:0,0",
      "L0:1,0",
      "L0:0,1",
      "L0:1,1",
    ]);
  });

  it("reports triangle counts from page indices", () => {
    expect(meshTriangleCount(world()[0])).toBe(160);
  });

  it("marks near visual casters with the visual mesh id", () => {
    const roots = world();
    const cut = selectShadowCut(roots, params({ nearVisualDistance: 96, proxyDistance: 192 }));
    const manifest = buildShadowManifest(roots, cut);

    const visual = manifest.entries.filter((entry) => entry.policy === "VisualMesh");
    expect(visual).toHaveLength(4);
    expect(visual.every((entry) => entry.shadowMeshId === entry.visualMeshId)).toBe(true);
    expect(manifest.totals.visualPages).toBe(4);
    expect(manifest.totals.proxyPages).toBe(0);
    expect(manifest.totals.casterPages).toBe(4);
  });

  it("marks proxy casters with a separate shadow mesh id and reduced budget", () => {
    const roots = world();
    const cut = selectShadowCut(roots, params({
      camPos: [256, 16, 64],
      nearVisualDistance: 32,
      proxyDistance: 256,
      proxyMinLevel: 1,
    }));
    const manifest = buildShadowManifest(roots, cut, { proxyTriangleRatio: 0.25 });
    const proxy = manifest.entries.find((entry) => entry.policy === "ClodShadowMesh");

    expect(proxy?.nodeId).toBe("L1:0,0");
    expect(proxy?.shadowMeshId).toBe("shadow:L1:0,0");
    expect(proxy?.shadowTriangleBudget).toBe(40);
    expect(manifest.totals.proxyPages).toBe(1);
    expect(manifest.totals.shadowTrianglesBudgeted).toBe(40);
  });

  it("marks pages outside the shadow cut as NoCast", () => {
    const roots = world();
    const cut = selectShadowCut(roots, params({
      camPos: [1024, 16, 1024],
      nearVisualDistance: 32,
      proxyDistance: 128,
    }));
    const manifest = buildShadowManifest(roots, cut);

    expect(manifest.entries.every((entry) => entry.policy === "NoCast")).toBe(true);
    expect(manifest.entries.every((entry) => entry.shadowMeshId === null)).toBe(true);
    expect(manifest.totals.noCastPages).toBe(5);
  });

  it("serializes stable JSON for exporter snapshots", () => {
    const roots = world();
    const cut = selectShadowCut(roots, params({ nearVisualDistance: 96, proxyDistance: 192 }));
    const json = serializeShadowManifest(buildShadowManifest(roots, cut));
    const parsed = JSON.parse(json);

    expect(json.endsWith("\n")).toBe(true);
    expect(parsed.version).toBe(1);
    expect(parsed.generatedBy).toBe("clod-poc-shadow-manifest");
    expect(parsed.totals.totalPages).toBe(5);
  });
});
