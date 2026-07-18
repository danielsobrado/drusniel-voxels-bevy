import { HydrologyEnvironmentQuery } from "../environment_query/hydrology_adapter.js";
import type { EnvironmentQuery } from "../environment_query/types.js";
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_RIVER,
  type HydrologySample,
} from "./hydrologyGrid.js";
import type { ContinentRiverRouteSample } from "./continent_river_route.js";

export function createContinentRiverRouteEnvironmentQuery(
  sample: (x: number, z: number) => ContinentRiverRouteSample,
): EnvironmentQuery {
  return new HydrologyEnvironmentQuery({
    hydrology: {
      sample: (x, z) => toHydrologySample(sample(x, z)),
    },
  });
}

function toHydrologySample(sample: ContinentRiverRouteSample): HydrologySample {
  const wet = sample.bodyKind !== HYDROLOGY_BODY_DRY && sample.depth > 0;
  const river = sample.bodyKind === HYDROLOGY_BODY_RIVER && sample.depth > 0;
  return {
    terrainY: sample.terrainY,
    waterY: sample.waterY,
    depth: sample.depth,
    bodyMask: wet ? 1 : 0,
    lakeMask: wet && !river ? 1 : 0,
    riverMask: river ? 1 : 0,
    flowX: sample.flowX,
    flowZ: sample.flowZ,
    flowStrength: Math.hypot(sample.flowX, sample.flowZ),
    riverDepth: river ? sample.depth : 0,
    waterYFar: sample.waterY,
    moisture: wet ? 1 : 0,
    bodyKind: sample.bodyKind,
    bodyId: sample.bodyId,
    shoreDistance: 0,
  };
}
