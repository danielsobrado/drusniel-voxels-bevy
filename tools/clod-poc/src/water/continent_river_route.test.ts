import { describe, expect, it } from "vitest";
import { HYDROLOGY_BODY_DRY, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import { findContinentRiverCrossingRoute } from "./continent_river_route.js";

describe("findContinentRiverCrossingRoute", () => {
  it("returns a dry-to-dry route perpendicular to a sampled river flow", () => {
    const route = findContinentRiverCrossingRoute((_x, z) => ({
      bodyKind: Math.abs(z) <= 4 ? HYDROLOGY_BODY_RIVER : HYDROLOGY_BODY_DRY,
      bodyId: 17,
      depth: Math.abs(z) <= 4 ? 2 : 0,
      flowX: 1,
      flowZ: 0,
      terrainY: 10,
      waterY: Math.abs(z) <= 4 ? 12 : -100,
    }), {
      centerX: 128,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
    });

    expect(route).not.toBeNull();
    expect(route?.riverBodyId).toBe(17);
    expect(route?.center).toEqual([64, 0]);
    expect(route?.start).toEqual([64, -48]);
    expect(route?.end).toEqual([64, 48]);
    expect(route?.centerDepthM).toBe(2);
  });

  it("returns null when the search window contains no river", () => {
    expect(findContinentRiverCrossingRoute(() => ({
      bodyKind: HYDROLOGY_BODY_DRY,
      bodyId: 0,
      depth: 0,
      flowX: 0,
      flowZ: 0,
      terrainY: 10,
      waterY: -100,
    }))).toBeNull();
  });
});
