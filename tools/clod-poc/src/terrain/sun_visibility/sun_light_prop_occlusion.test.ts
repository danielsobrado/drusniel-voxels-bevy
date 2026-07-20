import { describe, expect, it } from "vitest";
import type { LargePropOcclusionHeightPayload } from "../../props/large_prop_occlusion_height.js";
import { changedSunLightPropRegions } from "./sun_light_prop_occlusion.js";

function payload(
  revision: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): LargePropOcclusionHeightPayload {
  return {
    revision,
    cellSizeM: 4,
    cellX: new Int32Array([0]),
    cellZ: new Int32Array([0]),
    topY: new Float32Array([12]),
    minX,
    minZ,
    maxX,
    maxZ,
  };
}

describe("sun light prop occlusion invalidation", () => {
  it("invalidates both old and new coverage when props move", () => {
    expect(changedSunLightPropRegions(
      payload(1, 0, 0, 8, 8),
      payload(2, 20, 12, 32, 24),
    )).toEqual([
      { minX: 0, minZ: 0, maxX: 8, maxZ: 8 },
      { minX: 20, minZ: 12, maxX: 32, maxZ: 24 },
    ]);
  });

  it("deduplicates unchanged aggregate bounds", () => {
    expect(changedSunLightPropRegions(
      payload(1, -4, -4, 12, 12),
      payload(2, -4, -4, 12, 12),
    )).toEqual([{ minX: -4, minZ: -4, maxX: 12, maxZ: 12 }]);
  });

  it("invalidates old coverage on removal and new coverage on first appearance", () => {
    const current = payload(1, 0, 0, 4, 4);
    expect(changedSunLightPropRegions(current, null)).toEqual([
      { minX: 0, minZ: 0, maxX: 4, maxZ: 4 },
    ]);
    expect(changedSunLightPropRegions(null, current)).toEqual([
      { minX: 0, minZ: 0, maxX: 4, maxZ: 4 },
    ]);
    expect(changedSunLightPropRegions(null, null)).toEqual([]);
  });
});
