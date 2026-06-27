import { describe, expect, it } from "vitest";
import type { ClodPageNode, PageMesh } from "./types.js";
import {
  DEFAULT_SHADOW_CUT_PARAMS,
  selectShadowCut,
  shadowCutStats,
  shadowDistanceToPage,
  type ShadowCutParams,
} from "./shadow_clod.js";

const emptyMesh: PageMesh = {
  positions: new Float32Array(),
  normals: new Float32Array(),
  paintSlots: new Float32Array(),
  materialWeights: new Float32Array(),
  materialWeightStride: 4,
  indices: new Uint32Array(),
};

function node(
  id: string,
  level: number,
  minX: number,
  minZ: number,
  size: number,
  errorWorld: number,
  children: ClodPageNode[] = [],
): ClodPageNode {
  const center: [number, number, number] = [minX + size * 0.5, 0, minZ + size * 0.5];
  return {
    id,
    level,
    children,
    mesh: emptyMesh,
    footprint: { minX, minZ, maxX: minX + size, maxZ: minZ + size },
    bounds: { center, radius: Math.hypot(size, size) * 0.5, minY: 0, maxY: 0 },
    errorWorld,
    lowBenefit: false,
  };
}

function quadRoot(): ClodPageNode {
  const l0a = node("L0:0,0", 0, 0, 0, 64, 0);
  const l0b = node("L0:1,0", 0, 64, 0, 64, 0);
  const l0c = node("L0:0,1", 0, 0, 64, 64, 0);
  const l0d = node("L0:1,1", 0, 64, 64, 64, 0);
  return node("L1:0,0", 1, 0, 0, 128, 2, [l0a, l0b, l0c, l0d]);
}

function defaultParams(overrides: Partial<ShadowCutParams> = {}): ShadowCutParams {
  return {
    ...DEFAULT_SHADOW_CUT_PARAMS,
    viewportH: 1080,
    fovY: Math.PI / 3,
    camPos: [32, 16, 32],
    ...overrides,
  };
}

describe("shadowDistanceToPage", () => {
  it("returns zero inside the horizontal page footprint", () => {
    const n = node("n", 0, 0, 0, 64, 0);
    expect(shadowDistanceToPage(n, [32, 8, 32])).toBe(0);
  });

  it("measures horizontal distance to page bounds", () => {
    const n = node("n", 0, 0, 0, 64, 0);
    expect(shadowDistanceToPage(n, [80, 8, 32])).toBe(16);
    expect(shadowDistanceToPage(n, [80, 8, 80])).toBeCloseTo(Math.hypot(16, 16));
  });
});

describe("selectShadowCut", () => {
  it("uses a visual mesh caster for the near field", () => {
    const root = quadRoot();
    const result = selectShadowCut([root], defaultParams({
      nearVisualDistance: 96,
      proxyDistance: 192,
      maxCasterPages: 16,
    }));

    expect(result.casters.length).toBe(4);
    expect(result.casters.every((c) => c.policy === "visual")).toBe(true);
    expect(result.casters.every((c) => c.node.level === 0)).toBe(true);
    expect(result.stats.visualPages).toBe(4);
    expect(result.stats.proxyPages).toBe(0);
    expect(result.stats.nonePages).toBe(0);
  });

  it("uses a proxy caster when the page is outside the visual radius", () => {
    const root = quadRoot();
    const result = selectShadowCut([root], defaultParams({
      camPos: [256, 16, 64],
      nearVisualDistance: 32,
      proxyDistance: 256,
      maxCasterPages: 16,
      proxyMinLevel: 1,
    }));

    expect(result.casters).toHaveLength(1);
    expect(result.casters[0].node.id).toBe("L1:0,0");
    expect(result.casters[0].policy).toBe("proxy");
    expect(result.stats.proxyPages).toBe(1);
  });

  it("drops terrain outside the proxy shadow distance", () => {
    const root = quadRoot();
    const result = selectShadowCut([root], defaultParams({
      camPos: [1024, 16, 1024],
      nearVisualDistance: 32,
      proxyDistance: 128,
      maxCasterPages: 16,
    }));

    expect(result.casters).toHaveLength(0);
    expect(result.stats.nonePages).toBe(1);
  });

  it("keeps the nearest casters under a hard page budget", () => {
    const roots = [
      node("a", 0, 0, 0, 32, 0),
      node("b", 0, 64, 0, 32, 0),
      node("c", 0, 128, 0, 32, 0),
      node("d", 0, 192, 0, 32, 0),
    ];
    const result = selectShadowCut(roots, defaultParams({
      camPos: [16, 8, 16],
      nearVisualDistance: 512,
      proxyDistance: 512,
      maxCasterPages: 2,
    }));

    expect(result.casters.map((c) => c.node.id)).toEqual(["a", "b"]);
    expect(result.stats.budgetDroppedPages).toBe(2);
  });

  it("forces visual casters in the near-field bubble", () => {
    const root = quadRoot();
    const result = selectShadowCut([root], defaultParams({
      camPos: [512, 16, 512],
      nearVisualDistance: 0,
      proxyDistance: 1024,
      maxCasterPages: 16,
      nearField: {
        enabled: true,
        centerX: 32,
        centerZ: 32,
        radius: 8,
        boundaryPadding: 0,
      },
    }));

    expect(result.casters.length).toBeGreaterThan(0);
    expect(result.casters.every((c) => c.policy === "visual")).toBe(true);
    expect(result.stats.nearFieldForcedVisualPages).toBeGreaterThan(0);
  });

  it("reports consistent standalone stats", () => {
    const root = quadRoot();
    const result = selectShadowCut([root], defaultParams({
      camPos: [256, 16, 64],
      nearVisualDistance: 32,
      proxyDistance: 256,
      proxyMinLevel: 1,
    }));

    expect(shadowCutStats(result.casters)).toEqual({
      visualPages: 0,
      proxyPages: 1,
      nonePages: 0,
    });
  });

  it("nearFieldForcedVisualPages does not exceed visualPages after budget slicing", () => {
    const root = quadRoot();
    const result = selectShadowCut([root], defaultParams({
      camPos: [32, 16, 32],
      nearVisualDistance: 0,
      proxyDistance: 1024,
      maxCasterPages: 2,
      nearField: {
        enabled: true,
        centerX: 32,
        centerZ: 32,
        radius: 200,
        boundaryPadding: 0,
      },
    }));

    expect(result.casters.length).toBeLessThanOrEqual(2);
    expect(result.stats.nearFieldForcedVisualPages).toBeLessThanOrEqual(result.stats.visualPages);
  });

  it("documents root-precondition: a large root touching near-field forces entire subtree visual", () => {
    const smallLeaf = node("leaf:a", 0, 0, 0, 32, 0);
    const smallLeafB = node("leaf:b", 0, 200, 200, 32, 0);
    const largeRoot = node("big-root", 1, 0, 0, 256, 2, [smallLeaf, smallLeafB]);
    const result = selectShadowCut([largeRoot], defaultParams({
      camPos: [32, 16, 32],
      nearVisualDistance: 0,
      proxyDistance: 1024,
      maxCasterPages: 32,
      nearField: {
        enabled: true,
        centerX: 32,
        centerZ: 32,
        radius: 8,
        boundaryPadding: 0,
      },
    }));

    expect(result.casters.every((c) => c.policy === "visual")).toBe(true);
    expect(result.casters.every((c) => c.reason === "near-field")).toBe(true);
  });
});
