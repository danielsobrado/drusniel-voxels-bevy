import { HYDROLOGY_BODY_DRY, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";

export interface ContinentRiverRouteSample {
  bodyKind: number;
  bodyId: number;
  depth: number;
  flowX: number;
  flowZ: number;
  terrainY: number;
  waterY: number;
}

export interface ContinentRiverRouteSearchOptions {
  centerX?: number;
  centerZ?: number;
  searchRadiusM?: number;
  searchSpacingM?: number;
  crossingHalfSpanM?: number;
}

export interface ContinentRiverCrossingRoute {
  start: [number, number];
  center: [number, number];
  end: [number, number];
  flow: [number, number];
  riverBodyId: number;
  centerTerrainY: number;
  centerWaterY: number;
  centerDepthM: number;
}

export function findContinentRiverCrossingRoute(
  sample: (x: number, z: number) => ContinentRiverRouteSample,
  options: ContinentRiverRouteSearchOptions = {},
): ContinentRiverCrossingRoute | null {
  const centerX = options.centerX ?? 2048;
  const centerZ = options.centerZ ?? 2048;
  const searchRadiusM = Math.max(0, options.searchRadiusM ?? 1024);
  const searchSpacingM = Math.max(1, options.searchSpacingM ?? 16);
  const crossingHalfSpanM = Math.max(searchSpacingM, options.crossingHalfSpanM ?? 64);
  const minX = centerX - searchRadiusM;
  const minZ = centerZ - searchRadiusM;
  const cells = Math.floor(searchRadiusM * 2 / searchSpacingM);

  for (let iz = 0; iz <= cells; iz++) {
    const z = minZ + iz * searchSpacingM;
    for (let ix = 0; ix <= cells; ix++) {
      const x = minX + ix * searchSpacingM;
      const river = sample(x, z);
      if (river.bodyKind !== HYDROLOGY_BODY_RIVER || !(river.depth > 0)) continue;
      const flowLength = Math.hypot(river.flowX, river.flowZ);
      if (!(flowLength > 1e-6)) continue;
      const perpendicularX = -river.flowZ / flowLength;
      const perpendicularZ = river.flowX / flowLength;
      const start: [number, number] = [
        x - perpendicularX * crossingHalfSpanM,
        z - perpendicularZ * crossingHalfSpanM,
      ];
      const end: [number, number] = [
        x + perpendicularX * crossingHalfSpanM,
        z + perpendicularZ * crossingHalfSpanM,
      ];
      if (sample(start[0], start[1]).bodyKind !== HYDROLOGY_BODY_DRY) continue;
      if (sample(end[0], end[1]).bodyKind !== HYDROLOGY_BODY_DRY) continue;
      return {
        start,
        center: [x, z],
        end,
        flow: [river.flowX / flowLength, river.flowZ / flowLength],
        riverBodyId: river.bodyId,
        centerTerrainY: river.terrainY,
        centerWaterY: river.waterY,
        centerDepthM: river.depth,
      };
    }
  }
  return null;
}
