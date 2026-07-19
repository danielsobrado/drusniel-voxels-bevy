import { describe, expect, it } from "vitest";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_RIVER,
} from "./hydrologyGrid.js";
import {
  findContinentRiverCrossingRoute,
  findContinentRiverCrossingRouteFromSample,
  findValidatedContinentRiverCrossingRoute,
} from "./continent_river_route.js";

function horizontalRiverSample(_x: number, z: number) {
  return {
    bodyKind: Math.abs(z) <= 4 ? HYDROLOGY_BODY_RIVER : HYDROLOGY_BODY_DRY,
    bodyId: 17,
    depth: Math.abs(z) <= 4 ? 2 : 0,
    flowX: 1,
    flowZ: 0,
    terrainY: 10,
    waterY: Math.abs(z) <= 4 ? 12 : -100,
  };
}

describe("findContinentRiverCrossingRoute", () => {
  it("publishes runtime-resolution water identity after a coarse search", () => {
    const runtimeSample = (x: number, z: number) => ({
      ...horizontalRiverSample(x, z),
      bodyId: 23,
    });
    const route = findValidatedContinentRiverCrossingRoute(horizontalRiverSample, runtimeSample, {
      centerX: 128,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
      shoreProbeSpacingM: 2,
    });

    expect(route?.riverBodyId).toBe(23);
    expect(route?.waterEntry[1]).toBeCloseTo(-4, 1);
  });

  it("returns a dry-to-dry route perpendicular to flow with a refined shoreline", () => {
    const route = findContinentRiverCrossingRoute(horizontalRiverSample, {
      centerX: 128,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
      shoreProbeSpacingM: 2,
    });

    expect(route).not.toBeNull();
    expect(route?.riverBodyId).toBe(17);
    expect(route?.center).toEqual([64, 0]);
    expect(route?.start).toEqual([64, -48]);
    expect(route?.waterEntry[0]).toBeCloseTo(64);
    expect(route?.waterEntry[1]).toBeCloseTo(-4, 1);
    expect(route?.end).toEqual([64, 48]);
    expect(route?.centerDepthM).toBe(2);
  });

  it("rejects a crossing whose center-to-shore grade exceeds the navigation limit", () => {
    const steep = findContinentRiverCrossingRoute(horizontalRiverSample, {
      centerX: 128,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
      shoreProbeSpacingM: 2,
      maxShoreGrade: 0.4,
    });
    const navigable = findContinentRiverCrossingRoute(horizontalRiverSample, {
      centerX: 128,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
      shoreProbeSpacingM: 2,
      maxShoreGrade: 0.6,
    });

    expect(steep).toBeNull();
    expect(navigable).not.toBeNull();
  });

  it("rejects a route intercepted by a different water body", () => {
    const route = findContinentRiverCrossingRoute((_x, z) => ({
      bodyKind: Math.abs(z) <= 4
        ? HYDROLOGY_BODY_RIVER
        : z < -20 && z > -28
          ? HYDROLOGY_BODY_LAKE
          : HYDROLOGY_BODY_DRY,
      bodyId: Math.abs(z) <= 4 ? 17 : 9,
      depth: Math.abs(z) <= 4 ? 2 : z < -20 && z > -28 ? 1 : 0,
      flowX: 1,
      flowZ: 0,
      terrainY: 10,
      waterY: 12,
    }), {
      centerX: 128,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
    });

    expect(route).toBeNull();
  });

  it("falls back from non-finite options instead of entering an unbounded search", () => {
    let samples = 0;
    const route = findContinentRiverCrossingRoute((x, z) => {
      samples += 1;
      return horizontalRiverSample(x, z);
    }, {
      centerX: Number.NaN,
      centerZ: 0,
      searchRadiusM: Number.POSITIVE_INFINITY,
      searchSpacingM: Number.NaN,
      crossingHalfSpanM: Number.POSITIVE_INFINITY,
      shoreProbeSpacingM: Number.NaN,
    });

    expect(route).not.toBeNull();
    expect(samples).toBeLessThan(20_000);
  });

  it("caps extreme finite search inputs", () => {
    let samples = 0;
    const route = findContinentRiverCrossingRoute((x, z) => {
      samples += 1;
      return horizontalRiverSample(x, z);
    }, {
      centerX: 0,
      centerZ: 0,
      searchRadiusM: 1_000_000_000,
      searchSpacingM: 1,
      crossingHalfSpanM: 1_000_000_000,
      shoreProbeSpacingM: 0.25,
    });

    expect(route).not.toBeNull();
    expect(samples).toBeLessThan(100_000);
  });

  it("caps a search spacing larger than the crossing-span ceiling", () => {
    let samples = 0;
    const route = findContinentRiverCrossingRoute((x, z) => {
      samples += 1;
      return horizontalRiverSample(x, z);
    }, {
      centerX: 0,
      centerZ: 0,
      searchRadiusM: 8192,
      searchSpacingM: 1_000_000_000,
      crossingHalfSpanM: 1_000_000_000,
      shoreProbeSpacingM: 1,
    });

    expect(route).not.toBeNull();
    expect(samples).toBeLessThan(10_000);
  });

  it("rejects river samples without a canonical body id", () => {
    expect(findContinentRiverCrossingRoute((_x, z) => ({
      bodyKind: Math.abs(z) <= 4 ? HYDROLOGY_BODY_RIVER : HYDROLOGY_BODY_DRY,
      bodyId: 0,
      depth: Math.abs(z) <= 4 ? 2 : 0,
      flowX: 1,
      flowZ: 0,
      terrainY: 10,
      waterY: 12,
    }), {
      centerX: 0,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
    })).toBeNull();
  });

  it.each([
    { bodyId: -1, depth: 2, flowX: 1, flowZ: 0, terrainY: 10, waterY: 12 },
    { bodyId: 3.5, depth: 2, flowX: 1, flowZ: 0, terrainY: 10, waterY: 12 },
    { bodyId: 3, depth: Number.POSITIVE_INFINITY, flowX: 1, flowZ: 0, terrainY: 10, waterY: 12 },
    { bodyId: 3, depth: 2, flowX: Number.NaN, flowZ: 0, terrainY: 10, waterY: 12 },
    { bodyId: 3, depth: 2, flowX: 1, flowZ: 0, terrainY: Number.NaN, waterY: 12 },
    { bodyId: 3, depth: 2, flowX: 1, flowZ: 0, terrainY: 10, waterY: Number.NaN },
    { bodyId: 3, depth: 2, flowX: 1, flowZ: 0, terrainY: 10, waterY: 10 },
  ])("rejects malformed canonical river samples: %o", (invalid) => {
    expect(findContinentRiverCrossingRouteFromSample((_x, z) => ({
      bodyKind: Math.abs(z) <= 4 ? HYDROLOGY_BODY_RIVER : HYDROLOGY_BODY_DRY,
      bodyId: invalid.bodyId,
      depth: Math.abs(z) <= 4 ? invalid.depth : 0,
      flowX: invalid.flowX,
      flowZ: invalid.flowZ,
      terrainY: invalid.terrainY,
      waterY: invalid.waterY,
    }), {
      centerX: 0,
      centerZ: 0,
      searchRadiusM: 64,
      searchSpacingM: 16,
      crossingHalfSpanM: 48,
    })).toBeNull();
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
