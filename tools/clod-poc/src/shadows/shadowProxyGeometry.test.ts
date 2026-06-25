import { describe, expect, it } from "vitest";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import type { ClodPageNode } from "../types.js";
import { DEFAULT_SHADOW_PROXY_CONFIG } from "../config/longViewDefaults.js";
import { buildShadowProxyGeometry } from "./shadowProxyGeometry.js";
import { validateShadowProxyConfig, validateTerrainSummarySource } from "./shadowProxyValidation.js";

function makeNode(id: string, minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number): ClodPageNode {
  return {
    id,
    level: 0,
    footprint: { minX, minZ, maxX, maxZ },
    bounds: { minY, maxY },
    mesh: { positions: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) },
    children: [],
    parent: null,
  } as unknown as ClodPageNode;
}

describe("shadow proxy geometry", () => {
  const summary = buildTerrainSummary([
    makeNode("a", 0, 0, 256, 256, 0, 40),
    makeNode("b", 256, 256, 512, 512, 5, 55),
  ], 512, 8);

  it("builds expected vertex and triangle counts", () => {
    const config = { ...DEFAULT_SHADOW_PROXY_CONFIG, gridRes: 8, startM: 0, endM: 512 };
    const result = buildShadowProxyGeometry(summary, config);
    expect(result.geometry).not.toBeNull();
    expect(result.stats.vertexCount).toBe(9 * 9);
    expect(result.stats.triangleCount).toBeGreaterThan(0);
    const maxRingTris = 8 * 8 * 2;
    expect(result.stats.triangleCount).toBeLessThanOrEqual(maxRingTris);
  });

  it("produces finite positions and a bounding box", () => {
    const config = { ...DEFAULT_SHADOW_PROXY_CONFIG, gridRes: 4, startM: 0, endM: 256 };
    const result = buildShadowProxyGeometry(summary, config);
    const pos = result.geometry!.getAttribute("position").array as Float32Array;
    for (let i = 0; i < pos.length; i++) {
      expect(Number.isFinite(pos[i])).toBe(true);
    }
    expect(result.geometry!.boundingBox).not.toBeNull();
  });

  it("applies height bias and clamping", () => {
    const config = {
      ...DEFAULT_SHADOW_PROXY_CONFIG,
      gridRes: 4,
      startM: 0,
      endM: 256,
      heightBiasM: 10,
      minHeightM: 0,
      maxHeightM: 30,
    };
    const result = buildShadowProxyGeometry(summary, config);
    expect(result.stats.maxHeight).toBeLessThanOrEqual(30 + 0.01);
    expect(result.stats.minHeight).toBeGreaterThanOrEqual(0 - 0.01);
  });

  it("rejects invalid grid resolution", () => {
    const bad = { ...DEFAULT_SHADOW_PROXY_CONFIG, gridRes: 1 };
    const result = buildShadowProxyGeometry(summary, bad);
    expect(result.geometry).toBeNull();
    expect(result.error).toMatch(/gridRes/);
  });

  it("disables safely when summary is missing", () => {
    const result = buildShadowProxyGeometry(null, DEFAULT_SHADOW_PROXY_CONFIG);
    expect(result.geometry).toBeNull();
    expect(result.stats.built).toBe(false);
    expect(validateTerrainSummarySource(null).ok).toBe(false);
  });

  it("clamps NaN summary samples to min height", () => {
    const broken = { ...summary, heightMax: new Float32Array(summary.heightMax.length).fill(Number.NaN) };
    const config = { ...DEFAULT_SHADOW_PROXY_CONFIG, gridRes: 4, startM: 0, endM: 256 };
    const result = buildShadowProxyGeometry(broken, config);
    expect(result.geometry).not.toBeNull();
    expect(result.stats.minHeight).toBeGreaterThanOrEqual(config.minHeightM - 0.01);
    expect(result.stats.maxHeight).toBeLessThanOrEqual(config.maxHeightM + 0.01);
  });

  it("validates config degenerate ranges", () => {
    expect(validateShadowProxyConfig({ ...DEFAULT_SHADOW_PROXY_CONFIG, startM: 500, endM: 100 }).ok).toBe(false);
  });
});
