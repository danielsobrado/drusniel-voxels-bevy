import { describe, expect, it } from "vitest";
import type { EnvironmentQuery } from "./index.js";

function createQuery(): EnvironmentQuery {
  const meta = {
    source: "fallback" as const,
    revision: 0,
    valid: false,
    cellSizeM: 8,
  };

  return {
    surfaceHeightBestEffort: () => ({ height: null, meta }),
    surfaceNormal: () => ({ x: 0, y: 1, z: 0, meta }),
    materialWeights: () => ({ grass: 1, rock: 0, sand: 0, snow: 0, meta }),
    water: () => ({
      waterY: 0,
      carvedBedY: 0,
      depth: 0,
      wetMask: 0,
      shoreDistanceM: Number.POSITIVE_INFINITY,
      bodyKind: 0,
      bodyId: null,
      meta,
    }),
    river: () => ({
      flowX: 0,
      flowZ: 0,
      flowStrength: 0,
      bedDrop: 0,
      rapidMask: 0,
      channelCenterWeight: 0,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta,
    }),
    visibility: () => ({ sunVisibility: 1, meta }),
  };
}

describe("environment query contract", () => {
  it("allows honest missing surface results without inventing a height", () => {
    const result = createQuery().surfaceHeightBestEffort(0, 0, 8);
    expect(result.height).toBeNull();
    expect(result.meta.valid).toBe(false);
    expect(result.meta.cellSizeM).toBe(8);
  });
});
