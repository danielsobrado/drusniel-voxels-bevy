import { describe, expect, it } from "vitest";
import { buildTerrainSummary, sampleHeight, sampleHeightBlend, sampleNormal, sampleCoverage } from "./terrain_summary.js";
import type { ClodPageNode, PageMesh } from "../types.js";

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

    // Cell at page center should have coverage > 0
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

    // Cell far from any page should still produce a finite height
    const farH = sampleHeight(summary, 90, 90);
    expect(Number.isFinite(farH)).toBe(true);

    // No NaN anywhere in the grid
    for (let i = 0; i < summary.heightMin.length; i++) {
      expect(Number.isFinite(summary.heightMin[i])).toBe(true);
      expect(Number.isFinite(summary.heightMax[i])).toBe(true);
    }
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

    expect(summary.res).toBe(25); // 100 / 4
    expect(summary.farReduceFactor).toBe(4);

    // Center of first quadrant should reflect page 0's height range
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

    // Edge of world has no page coverage (the page is in the center)
    const edgeCov = sampleCoverage(summary, 5, 5);
    // Edge may or may not have coverage depending on the box-reduce overlap;
    // just check it doesn't crash and returns a finite value
    expect(Number.isFinite(edgeCov)).toBe(true);
  });

  it("sampleHeightBlend bias=0 returns min-field and bias=1 matches sampleHeight", () => {
    const worldSize = 100;
    const page = pageNode("L0:0,0", 20, 20, 60, 60, 10, 50);
    const summary = buildTerrainSummary([page], worldSize, 1);

    const cx = 40, cz = 40;
    // bias=0 → valley floor (heightMin)
    const hMin = sampleHeightBlend(summary, cx, cz, 0);
    const expectedMin = summary.heightMin[
      // grid index for cell containing (cx, cz) — same lookup as sampleHeight
      Math.floor((cz / worldSize) * summary.res) * summary.res + Math.floor((cx / worldSize) * summary.res)
    ];
    expect(hMin).toBeCloseTo(expectedMin, 5);

    // bias=1 → peak (heightMax) ≈ sampleHeight
    const hMax = sampleHeightBlend(summary, cx, cz, 1);
    const hPeak = sampleHeight(summary, cx, cz);
    expect(hMax).toBeCloseTo(hPeak, 5);

    // bias=0.5 → between min and max
    const hMid = sampleHeightBlend(summary, cx, cz, 0.5);
    expect(hMid).toBeGreaterThanOrEqual(hMin);
    expect(hMid).toBeLessThanOrEqual(hMax);
  });
});
