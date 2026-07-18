import { describe, expect, it } from "vitest";
import { HydrologyEnvironmentQuery } from "../environment_query/hydrology_adapter.js";
import type { HydrologySample } from "./hydrologyGrid.js";
import {
  CONTINENT_RIVER_ROUTE_SAMPLE_HINT_M,
  findContinentRiverCrossingRoute,
  findContinentRiverCrossingRouteFromEnvironmentQuery,
  type ContinentRiverRouteSearchOptions,
} from "./continent_river_route.js";

const OPTIONS: ContinentRiverRouteSearchOptions = {
  centerX: 0,
  centerZ: 0,
  searchRadiusM: 16,
  searchSpacingM: 4,
  crossingHalfSpanM: 12,
  shoreProbeSpacingM: 2,
};

function sampleRiverStrip(x: number): HydrologySample {
  const river = Math.abs(x) <= 4;
  return {
    terrainY: river ? 0 : 2,
    waterY: river ? 2 : -8,
    depth: river ? 2 : 0,
    bodyMask: river ? 1 : 0,
    lakeMask: 0,
    riverMask: river ? 1 : 0,
    flowX: 0,
    flowZ: river ? 1 : 0,
    flowStrength: river ? 1 : 0,
    riverDepth: river ? 2 : 0,
    waterYFar: river ? 2 : -8,
    moisture: river ? 1 : 0,
    bodyKind: river ? 3 : 0,
    bodyId: river ? 7 : 0,
    shoreDistance: Math.abs(Math.abs(x) - 4),
  };
}

describe("continent river route EnvironmentQuery adapter", () => {
  it("matches direct hydrology sampling and preserves the coarse route hint", () => {
    let directSamples = 0;
    const direct = findContinentRiverCrossingRoute((x) => {
      directSamples += 1;
      const sample = sampleRiverStrip(x);
      return {
        bodyKind: sample.bodyKind,
        bodyId: sample.bodyId,
        depth: sample.depth,
        flowX: sample.flowX,
        flowZ: sample.flowZ,
        terrainY: sample.terrainY,
        waterY: sample.waterY,
      };
    }, OPTIONS);

    const hints: number[] = [];
    let adaptedSamples = 0;
    const query = new HydrologyEnvironmentQuery({
      hydrology: {
        sample: (x, _z, hint) => {
          adaptedSamples += 1;
          hints.push(hint);
          return sampleRiverStrip(x);
        },
      },
      nowMs: () => 0,
    });
    const adapted = findContinentRiverCrossingRouteFromEnvironmentQuery(query, OPTIONS);

    expect(adapted).toEqual(direct);
    expect(adaptedSamples).toBe(directSamples);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => hint === CONTINENT_RIVER_ROUTE_SAMPLE_HINT_M)).toBe(true);
  });
});
