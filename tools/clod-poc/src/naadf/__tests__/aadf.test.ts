import { describe, expect, it } from "vitest";
import { computeAadfForMipNode, estimateSafeSkipDistance, nodeRequiresRefine, sunNodeBlocksRay } from "../aadf.js";
import type { MipSummaryNode } from "../types.js";
import { parseNaadfPocConfig } from "../config.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

const emptyNode: MipSummaryNode = {
  occupiedAny: false,
  occupiedAll: false,
  minHeight: 0,
  maxHeight: 0,
  avgHeight: 0,
  avgNormalX: 0,
  avgNormalY: 1,
  avgNormalZ: 0,
  normalVariance: 0,
  dominantMaterial: 0,
  materialVariance: 0,
  aadfPosX: 0,
  aadfNegX: 0,
  aadfPosZ: 0,
  aadfNegZ: 0,
  aadfPosY: 0,
  aadfNegY: 0,
  canopyCoverage: 0,
  waterCoverage: 0,
};

describe("naadf aadf", () => {
  const config = parseNaadfPocConfig(naadfYaml);

  it("skip distance is finite", () => {
    const aadf = computeAadfForMipNode(emptyNode, 4, 1);
    const skip = estimateSafeSkipDistance({
      node: { ...emptyNode, aadfPosX: aadf.posX, aadfNegX: aadf.negX, aadfPosZ: aadf.posZ, aadfNegZ: aadf.negZ, aadfPosY: aadf.posY, aadfNegY: aadf.negY },
      rayDirX: 1,
      rayDirY: 0,
      rayDirZ: 0,
      cellSizeM: 1,
      nextCellBoundaryDistanceM: 4,
      epsilonM: 0.01,
      config,
    });
    expect(Number.isFinite(skip)).toBe(true);
  });

  it("skip distance is never NaN", () => {
    const skip = estimateSafeSkipDistance({
      node: emptyNode,
      rayDirX: 0,
      rayDirY: 0,
      rayDirZ: 0,
      cellSizeM: 1,
      nextCellBoundaryDistanceM: 1,
      epsilonM: 0.01,
      config,
    });
    expect(Number.isNaN(skip)).toBe(false);
  });

  it("skip distance is never negative", () => {
    const skip = estimateSafeSkipDistance({
      node: emptyNode,
      rayDirX: 1,
      rayDirY: -1,
      rayDirZ: 0,
      cellSizeM: 1,
      nextCellBoundaryDistanceM: 2,
      epsilonM: 0.01,
      config,
    });
    expect(skip).toBeGreaterThanOrEqual(0);
  });

  it("mixed nodes refine", () => {
    const mixed: MipSummaryNode = {
      ...emptyNode,
      occupiedAny: true,
      occupiedAll: false,
      materialVariance: 0.5,
    };
    expect(nodeRequiresRefine(mixed, config)).toBe(true);
  });

  it("high variance nodes refine", () => {
    const node: MipSummaryNode = { ...emptyNode, occupiedAny: true, occupiedAll: true, normalVariance: 0.2 };
    expect(nodeRequiresRefine(node, config)).toBe(true);
  });

  it("sun unknown behavior respects config", () => {
    expect(config.query.unknownCountsAsBlockedForSun).toBe(true);
  });

  it("sun ray above terrain max height is visible", () => {
    const occluder: MipSummaryNode = {
      ...emptyNode,
      occupiedAny: true,
      occupiedAll: true,
      minHeight: 0,
      maxHeight: 10,
      avgHeight: 5,
    };
    expect(sunNodeBlocksRay(occluder, 20, config)).toBe("visible");
  });
});
