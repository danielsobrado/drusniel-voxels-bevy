import { describe, expect, it } from "vitest";
import {
  buildTerrainSummary,
  createExtendedCanopyTexture,
  sampleHeight,
  sampleHeightBlend,
  sampleNormal,
  sampleCoverage,
  sampleBiomeId,
  sampleSkirtHeight,
  summaryBaseLevel,
} from "./terrain_summary.js";
import type { ClodPageNode, PageMesh } from "../types.js";
import { BIOME_IDS } from "../world_source/biome_region_field.js";

const mesh: PageMesh = {
  positions: new Float32Array([0, 5, 0, 1, 5, 0, 0, 5, 1]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  paintSlots: new Float32Array([0, 0, 0]),
  materialWeights: new Float32Array(12),
  materialWeightStride: 4,
  indices: new Uint32Array([0, 1, 2]),
};

function pageNode(
  id: string,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  minY: number,
  maxY: number,
): ClodPageNode {
  return {
    id,
    level: 0,
    children: [],
    mesh,
    footprint: { minX, minZ, maxX, maxZ },
    bounds: {
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      radius: Math.hypot(maxX - minX, maxZ - minZ, maxY - minY),
      minY,
      maxY,
    },
    errorWorld: 0,
    lowBenefit: false,
  };
}

describe("terrain summary field", () => {
  it("builds from a single page and covers its footprint", () => {
    const worldSize = 100;
    const page = pageNode("L0:0,0", 20, 20, 60, 60, 10, 50);
    const summary = buildTerrainSummary([page], worldSize, 1);

    expect(summary.res).toBe(worldSize);
    expect(summary.worldSize).toBe(worldSize);

    const cx = 40, cz = 40;
    const h = sampleHeight(summary, cx, cz);
    expect(h).toBeGreaterThanOrEqual(10);
    expect(h).toBeLessThanOrEqual(50);

    const cov = sampleCoverage(summary, cx, cz);
    expect(cov).toBeGreaterThan(0);
  });

  it("falls back to surfaceHeightCore for uncovered cells (no NaN)", () => {
    const worldSize = 100;
    const page = pageNode("L0:0,0", 0, 0, 50, 50, 10, 50);
    const summary = buildTerrainSummary([page], worldSize, 1);

    const farH = sampleHeight(summary, 90, 90);
    expect(Number.isFinite(farH)).toBe(true);

    for (let i = 0; i < summary.heightMin.length; i++) {
      expect(Number.isFinite(summary.heightMin[i])).toBe(true);
      expect(Number.isFinite(summary.heightMax[i])).toBe(true);
    }
  });

  it("uses WorldSource for uncovered summary cells and skirt fallback", () => {
    const worldSource = {
      sampleHeight: () => 77,
      sampleBiome: () => BIOME_IDS.plains,
    };
    const summary = buildTerrainSummary([], 16, 16, { worldSource });

    expect(sampleHeight(summary, 8, 8)).toBe(77);
    expect(sampleBiomeId(summary, 8, 8)).toBe(BIOME_IDS.plains);
    expect(sampleBiomeId(summary, -8, -8)).toBe(BIOME_IDS.plains);
    expect(sampleSkirtHeight(summary, -4, -4, 100, summaryBaseLevel(summary), 1)).toBe(77);
  });

  it("keeps the finite far skirt continuous with the baked terrain at the world edge", () => {
    const worldSource = {
      sampleHeight: (x: number) => 100 + x,
      sampleBiome: () => BIOME_IDS.plains,
    };
    const summary = buildTerrainSummary([pageNode("L0:0,0", 0, 0, 16, 16, 1, 2)], 16, 1, { worldSource });
    const edgeHeight = sampleHeightBlend(summary, 0, 8, 1);

    expect(sampleSkirtHeight(summary, 0, 8, 100, 0, 1)).toBeCloseTo(edgeHeight, 6);
    expect(sampleSkirtHeight(summary, -0.001, 8, 100, 0, 1)).toBeCloseTo(edgeHeight, 2);
  });

  it("samples WorldSource height, normal, coverage, and biome beyond the finite summary footprint", () => {
    const worldSource = {
      sampleHeight: (x: number, z: number) => 100 + x * 0.5 + z * 0.25,
      sampleBiome: () => BIOME_IDS.forest,
    };
    const summary = buildTerrainSummary([pageNode("L0:0,0", 0, 0, 16, 16, 1, 2)], 16, 1, { worldSource });

    expect(sampleHeight(summary, 64, 32)).toBe(worldSource.sampleHeight(64, 32));
    expect(sampleHeightBlend(summary, 64, 32, 0)).toBe(worldSource.sampleHeight(64, 32));
    expect(sampleCoverage(summary, 64, 32)).toBe(0);
    expect(sampleBiomeId(summary, 64, 32)).toBe(BIOME_IDS.forest);

    const [nx, ny, nz] = sampleNormal(summary, 64, 32);
    expect(Number.isFinite(nx)).toBe(true);
    expect(Number.isFinite(ny)).toBe(true);
    expect(Number.isFinite(nz)).toBe(true);
    expect(Math.abs(Math.hypot(nx, ny, nz) - 1)).toBeLessThan(0.01);
  });

  it("gates extended canopy by biome", () => {
    const oceanSummary = buildTerrainSummary([], 16, 16, {
      worldSource: {
        sampleHeight: () => 0,
        sampleBiome: () => BIOME_IDS.ocean,
      },
    });
    const canopy = createExtendedCanopyTexture(oceanSummary, 32, 1);
    const data = canopy.image.data as Float32Array;

    for (const value of data) expect(value).toBe(0);
    canopy.dispose();
  });

  it("normals are unit vectors", () => {
    const worldSize = 50;
    const pages = [
      pageNode("L0:0,0", 0, 0, 25, 25, 10, 30),
      pageNode("L0:1,0", 25, 0, 50, 25, 20, 40),
    ];
    const summary = buildTerrainSummary(pages, worldSize, 1);

    for (let fz = 0; fz < summary.res; fz++) {
      for (let fx = 0; fx < summary.res; fx++) {
        const [nx, ny, nz] = sampleNormal(summary, (fx + 0.5) * (worldSize / summary.res), (fz + 0.5) * (worldSize / summary.res));
        const len = Math.hypot(nx, ny, nz);
        expect(Math.abs(len - 1)).toBeLessThan(0.01);
      }
    }
  });

  it("downsamples correctly with farReduceFactor > 1", () => {
    const worldSize = 100;
    const pages = [
      pageNode("L0:0,0", 0, 0, 50, 50, 10, 30),
      pageNode("L0:1,0", 50, 0, 100, 50, 20, 40),
    ];
    const summary = buildTerrainSummary(pages, worldSize, 4);

    expect(summary.res).toBe(25);
    expect(summary.farReduceFactor).toBe(4);

    const h = sampleHeight(summary, 25, 25);
    expect(h).toBeGreaterThanOrEqual(10);
    expect(h).toBeLessThanOrEqual(30);
  });

  it("coverage is 0 at edges and > 0 at center", () => {
    const worldSize = 100;
    const page = pageNode("L0:0,0", 25, 25, 75, 75, 10, 50);
    const summary = buildTerrainSummary([page], worldSize, 1);

    const centerCov = sampleCoverage(summary, 50, 50);
    expect(centerCov).toBeGreaterThan(0);

    const edgeCov = sampleCoverage(summary, 5, 5);
    expect(Number.isFinite(edgeCov)).toBe(true);
  });

  it("sampleHeightBlend bias=0 returns min-field and bias=1 matches sampleHeight", () => {
    const worldSize = 100;
    const page = pageNode("L0:0,0", 20, 20, 60, 60, 10, 50);
    const summary = buildTerrainSummary([page], worldSize, 1);

    const cx = 40, cz = 40;
    const hMin = sampleHeightBlend(summary, cx, cz, 0);
    const expectedMin = summary.heightMin[
      Math.floor((cz / worldSize) * summary.res) * summary.res + Math.floor((cx / worldSize) * summary.res)
    ];
    expect(hMin).toBeCloseTo(expectedMin, 5);

    const hMax = sampleHeightBlend(summary, cx, cz, 1);
    const hPeak = sampleHeight(summary, cx, cz);
    expect(hMax).toBeCloseTo(hPeak, 5);

    const hMid = sampleHeightBlend(summary, cx, cz, 0.5);
    expect(hMid).toBeGreaterThanOrEqual(hMin);
    expect(hMid).toBeLessThanOrEqual(hMax);
  });
});
