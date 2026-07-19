import { describe, expect, it, vi } from "vitest";
import {
  formatEnvironmentQueryMeta,
  formatEnvironmentQueryProbeValues,
  sampleEnvironmentQueryProbe,
} from "./probe.js";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "./types.js";

const terrainMeta: EnvironmentQueryMeta = {
  source: "live-terrain",
  revision: 7,
  valid: true,
  cellSizeM: 16,
};
const hydrologyMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 5,
  valid: true,
  cellSizeM: 16,
};
const visibilityMeta: EnvironmentQueryMeta = {
  source: "sun-visibility-cache",
  revision: 9,
  valid: true,
  cellSizeM: 16,
};

function queryFixture(): EnvironmentQuery {
  return {
    surfaceHeightBestEffort: vi.fn(() => ({ height: 20, meta: terrainMeta })),
    surfaceNormal: vi.fn(() => ({ x: 0, y: 1, z: 0, meta: terrainMeta })),
    materialWeights: vi.fn(() => ({ grass: 0.5, rock: 0.25, sand: 0.25, snow: 0, meta: terrainMeta })),
    water: vi.fn(() => ({
      waterY: 21,
      carvedBedY: 20,
      depth: 1,
      wetMask: 1,
      shoreDistanceM: 2,
      bodyKind: 3,
      bodyId: 4,
      meta: hydrologyMeta,
    })),
    river: vi.fn(() => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 0.8,
      bedDrop: 0,
      rapidMask: 0.2,
      channelCenterWeight: 1,
      bankContactWeight: 0,
      gravelBarMask: 0.4,
      meta: hydrologyMeta,
    })),
    visibility: vi.fn(() => ({ sunVisibility: 0.3, meta: visibilityMeta })),
  };
}

describe("environment query probe", () => {
  it("normalizes one hint and passes it unchanged to every field", () => {
    const query = queryFixture();
    const probe = sampleEnvironmentQueryProbe(query, 12, 34, 0);

    expect(probe.hintM).toBe(0.01);
    for (const method of [
      query.surfaceHeightBestEffort,
      query.surfaceNormal,
      query.materialWeights,
      query.water,
      query.river,
      query.visibility,
    ]) {
      expect(method).toHaveBeenCalledWith(12, 34, 0.01);
    }
  });

  it("formats ownership and sampled values compactly", () => {
    const probe = sampleEnvironmentQueryProbe(queryFixture(), 12, 34, 16);

    expect(formatEnvironmentQueryMeta(probe.surface.meta)).toBe("live-terrain | valid | r7 | 16.00 m");
    expect(formatEnvironmentQueryProbeValues(probe)).toBe(
      "h=20.00 | n=0.00,1.00,0.00 | grass=0.50 | rock=0.25 | wet=1.00 | depth=1.00 | flow=0.80 | bar=0.40 | sun=0.30",
    );
  });

  it("formats malformed metadata without leaking NaN", () => {
    expect(formatEnvironmentQueryMeta({
      source: "fallback",
      revision: Number.NaN,
      valid: false,
      cellSizeM: Number.NaN,
    })).toBe("fallback | invalid | r0 | n/a m");
  });
});
