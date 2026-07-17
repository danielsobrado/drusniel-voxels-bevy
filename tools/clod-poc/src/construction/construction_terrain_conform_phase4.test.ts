import { describe, expect, it } from "vitest";
import {
  analyzeConstructionTerrainSamples,
  constructionTerrainSamplePositions,
  createConstructionTerrainConformRequest,
} from "./construction_terrain_conform.js";
import type { ConstructionCandidate, ConstructionTerrainConformConfig } from "./types.js";

const foundationCandidate: ConstructionCandidate = {
  piece: {
    id: "foundation",
    label: "Foundation",
    category: "foundation",
    dimensionsM: [2, 1, 2],
    canGround: true,
    material: "concrete",
    snapPoints: [],
  },
  material: "concrete",
  position: [10, 5, 10],
  rotationQuarterTurns: 0,
  snapped: false,
  valid: true,
  reason: null,
  snap: null,
  terrainHit: null,
  supportState: "grounded",
  connectionIds: [],
  stabilityValue: 1,
  stabilityMaxSupport: 1,
  stabilityGrounded: true,
};
const config: ConstructionTerrainConformConfig = {
  enabled: true,
  foundationCategories: ["foundation"],
  padMarginM: 0.25,
  fillDepthM: 2.5,
  trimHeightM: 1.2,
  falloffM: 0.1,
  materialSlot: 1,
};

describe("construction terrain conform Phase 4", () => {
  it("creates a rotated placement-footprint request only for free foundations", () => {
    const request = createConstructionTerrainConformRequest(foundationCandidate, config);
    expect(request).not.toBeNull();
    expect(request!.footprint).toEqual({ minX: 8.75, maxX: 11.25, minZ: 8.75, maxZ: 11.25, targetY: 4.5 });
    expect(constructionTerrainSamplePositions(request!)).toHaveLength(9);
    expect(createConstructionTerrainConformRequest({ ...foundationCandidate, snapped: true }, config)).toBeNull();
    expect(createConstructionTerrainConformRequest({
      ...foundationCandidate,
      piece: { ...foundationCandidate.piece, category: "floor" },
    }, config)).toBeNull();
  });

  it("estimates fill and cut volume from the full footprint", () => {
    const request = createConstructionTerrainConformRequest(foundationCandidate, config)!;
    const positions = constructionTerrainSamplePositions(request);
    const preview = analyzeConstructionTerrainSamples(request, positions.map((position, index) => ({
      ...position,
      surfaceY: index < 3 ? 4 : index < 6 ? 4.5 : 5,
    })));
    expect(preview.valid).toBe(true);
    expect(preview.changed).toBe(true);
    expect(preview.sampleCount).toBe(9);
    expect(preview.maxFillDepthM).toBeCloseTo(0.5);
    expect(preview.maxCutHeightM).toBeCloseTo(0.5);
    expect(preview.fillVolumeM3).toBeGreaterThan(0);
    expect(preview.cutVolumeM3).toBeGreaterThan(0);
  });

  it("rejects a footprint that exceeds configured fill depth", () => {
    const request = createConstructionTerrainConformRequest(foundationCandidate, config)!;
    const preview = analyzeConstructionTerrainSamples(request, constructionTerrainSamplePositions(request).map((position) => ({
      ...position,
      surfaceY: 1,
    })));
    expect(preview.valid).toBe(false);
    expect(preview.reason).toContain("fill requires");
  });
});
