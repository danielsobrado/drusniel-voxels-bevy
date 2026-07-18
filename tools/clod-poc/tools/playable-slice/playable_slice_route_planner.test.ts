import { describe, expect, it } from "vitest";
import type { ContinentRiverCrossingRoute } from "../../src/water/continent_river_route.js";
import { planPlayableSliceRoute, playerYawForDirection } from "./playable_slice_route_planner.js";

function route(overrides: Partial<ContinentRiverCrossingRoute> = {}): ContinentRiverCrossingRoute {
  return {
    start: [48, 20],
    waterEntry: [96, 20],
    center: [112, 20],
    end: [176, 20],
    flow: [0, 1],
    riverBodyId: 7,
    centerTerrainY: 10,
    centerWaterY: 14,
    centerDepthM: 4,
    ...overrides,
  };
}

describe("playable slice route planner", () => {
  it("starts before a page boundary and keeps the build point dry", () => {
    const plan = planPlayableSliceRoute(route(), 64, 8);

    expect(plan.boundary).toEqual([64, 20]);
    expect(plan.spawn).toEqual([56, 20]);
    expect(plan.direction[0]).toBeCloseTo(1);
    expect(plan.direction[1]).toBeCloseTo(0);
    expect(plan.boundaryDistanceM).toBe(8);
    expect(plan.waterEntry).toEqual([96, 20]);
    expect(plan.yaw).toBeCloseTo(-Math.PI / 2);
  });

  it("handles diagonal crossings deterministically", () => {
    const plan = planPlayableSliceRoute(route({
      start: [50, 50],
      waterEntry: [110, 110],
      center: [130, 130],
      end: [180, 180],
    }), 64, 6);

    expect(plan.boundary[0]).toBeCloseTo(64);
    expect(plan.boundary[1]).toBeCloseTo(64);
    expect(Math.hypot(plan.spawn[0] - plan.boundary[0], plan.spawn[1] - plan.boundary[1])).toBeCloseTo(6);
  });

  it("rejects a page boundary that lies after the actual shoreline", () => {
    expect(() => planPlayableSliceRoute(route({
      start: [48, 20],
      waterEntry: [60, 20],
      center: [160, 20],
      end: [220, 20],
    }), 64)).toThrow("does not cross a page boundary");
  });

  it("rejects routes that cannot exercise a boundary before water", () => {
    expect(() => planPlayableSliceRoute(route({
      start: [10, 10],
      waterEntry: [18, 10],
      center: [20, 10],
      end: [30, 10],
    }), 64)).toThrow("does not cross a page boundary");
  });

  it("rejects a shoreline that is not on the bank-to-center approach", () => {
    expect(() => planPlayableSliceRoute(route({ waterEntry: [80, 30] }), 64)).toThrow(
      "water entry must lie on the dry-bank approach",
    );
  });

  it("matches the player controller forward-vector convention", () => {
    expect(playerYawForDirection([0, -1])).toBeCloseTo(0);
    expect(playerYawForDirection([1, 0])).toBeCloseTo(-Math.PI / 2);
  });
});
