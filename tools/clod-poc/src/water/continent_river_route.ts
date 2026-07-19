import type { EnvironmentQuery } from "../environment_query/types.js";
import { createContinentRiverRouteEnvironmentQuery } from "./continent_river_route_query_adapter.js";
import { HYDROLOGY_BODY_DRY, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";

const DEFAULT_CENTER_M = 2048;
const DEFAULT_SEARCH_RADIUS_M = 1024;
const DEFAULT_SEARCH_SPACING_M = 16;
const DEFAULT_CROSSING_HALF_SPAN_M = 64;
const DEFAULT_SHORE_PROBE_SPACING_M = 2;
const MAX_SEARCH_RADIUS_M = 8192;
const MAX_SEARCH_CELLS_PER_AXIS = 256;
const MAX_CROSSING_HALF_SPAN_M = 4096;
const MAX_SEARCH_SPACING_M = MAX_CROSSING_HALF_SPAN_M;
const MAX_SHORE_PROBE_SPACING_M = 16;
const MAX_SHORE_PROBES = 4096;
const SHORE_REFINEMENT_STEPS = 8;
export const CONTINENT_RIVER_ROUTE_SAMPLE_HINT_M = 64;

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
  shoreProbeSpacingM?: number;
  maxShoreGrade?: number;
}

export interface ContinentRiverCrossingRoute {
  start: [number, number];
  waterEntry: [number, number];
  center: [number, number];
  end: [number, number];
  flow: [number, number];
  riverBodyId: number;
  centerTerrainY: number;
  centerWaterY: number;
  centerDepthM: number;
}

function finiteOption(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isCanonicalRiverSample(sample: ContinentRiverRouteSample): boolean {
  return sample.bodyKind === HYDROLOGY_BODY_RIVER
    && Number.isSafeInteger(sample.bodyId)
    && sample.bodyId > 0
    && Number.isFinite(sample.depth)
    && sample.depth > 0
    && Number.isFinite(sample.flowX)
    && Number.isFinite(sample.flowZ)
    && Number.isFinite(sample.terrainY)
    && Number.isFinite(sample.waterY)
    && sample.waterY > sample.terrainY;
}

function isRouteRiver(sample: ContinentRiverRouteSample, bodyId: number): boolean {
  return isCanonicalRiverSample(sample) && sample.bodyId === bodyId;
}

function findWaterEntry(
  sample: (x: number, z: number) => ContinentRiverRouteSample,
  start: readonly [number, number],
  center: readonly [number, number],
  bodyId: number,
  requestedSpacingM: number,
): [number, number] | null {
  const dx = center[0] - start[0];
  const dz = center[1] - start[1];
  const lengthM = Math.hypot(dx, dz);
  if (!(lengthM > 0)) return null;
  const directionX = dx / lengthM;
  const directionZ = dz / lengthM;
  const spacingM = Math.max(requestedSpacingM, lengthM / MAX_SHORE_PROBES);
  const probeSteps = Math.ceil(lengthM / spacingM);
  let dryPoint: [number, number] = [start[0], start[1]];

  for (let probe = 1; probe <= probeSteps; probe += 1) {
    const distanceM = Math.min(probe * spacingM, lengthM);
    const point: [number, number] = [
      start[0] + directionX * distanceM,
      start[1] + directionZ * distanceM,
    ];
    const result = sample(point[0], point[1]);
    if (isRouteRiver(result, bodyId)) {
      let low = dryPoint;
      let high = point;
      for (let step = 0; step < SHORE_REFINEMENT_STEPS; step += 1) {
        const midpoint: [number, number] = [
          (low[0] + high[0]) * 0.5,
          (low[1] + high[1]) * 0.5,
        ];
        const midpointSample = sample(midpoint[0], midpoint[1]);
        if (isRouteRiver(midpointSample, bodyId)) high = midpoint;
        else if (midpointSample.bodyKind === HYDROLOGY_BODY_DRY) low = midpoint;
        else return null;
      }
      return high;
    }
    if (result.bodyKind !== HYDROLOGY_BODY_DRY) return null;
    dryPoint = point;
  }
  return null;
}

export function findContinentRiverCrossingRouteFromSample(
  sample: (x: number, z: number) => ContinentRiverRouteSample,
  options: ContinentRiverRouteSearchOptions = {},
  validateSample: (x: number, z: number) => ContinentRiverRouteSample = sample,
): ContinentRiverCrossingRoute | null {
  const centerX = finiteOption(options.centerX, DEFAULT_CENTER_M);
  const centerZ = finiteOption(options.centerZ, DEFAULT_CENTER_M);
  const searchRadiusM = clamp(
    finiteOption(options.searchRadiusM, DEFAULT_SEARCH_RADIUS_M),
    0,
    MAX_SEARCH_RADIUS_M,
  );
  const requestedSearchSpacingM = clamp(
    finiteOption(options.searchSpacingM, DEFAULT_SEARCH_SPACING_M),
    1,
    MAX_SEARCH_SPACING_M,
  );
  const searchSpacingM = clamp(
    Math.max(requestedSearchSpacingM, searchRadiusM * 2 / MAX_SEARCH_CELLS_PER_AXIS),
    1,
    MAX_SEARCH_SPACING_M,
  );
  const crossingHalfSpanM = clamp(
    finiteOption(options.crossingHalfSpanM, DEFAULT_CROSSING_HALF_SPAN_M),
    searchSpacingM,
    MAX_CROSSING_HALF_SPAN_M,
  );
  const shoreProbeSpacingM = clamp(
    finiteOption(options.shoreProbeSpacingM, DEFAULT_SHORE_PROBE_SPACING_M),
    0.25,
    MAX_SHORE_PROBE_SPACING_M,
  );
  const maxShoreGrade = options.maxShoreGrade === undefined
    ? Number.POSITIVE_INFINITY
    : clamp(finiteOption(options.maxShoreGrade, Number.POSITIVE_INFINITY), 0, 10);
  const minX = centerX - searchRadiusM;
  const minZ = centerZ - searchRadiusM;
  const cells = Math.floor(searchRadiusM * 2 / searchSpacingM);

  for (let iz = 0; iz <= cells; iz++) {
    const z = minZ + iz * searchSpacingM;
    for (let ix = 0; ix <= cells; ix++) {
      const x = minX + ix * searchSpacingM;
      const coarseRiver = sample(x, z);
      if (!isCanonicalRiverSample(coarseRiver)) continue;
      const river = validateSample === sample ? coarseRiver : validateSample(x, z);
      if (!isCanonicalRiverSample(river)) continue;
      const flowLength = Math.hypot(river.flowX, river.flowZ);
      if (!Number.isFinite(flowLength) || !(flowLength > 1e-6)) continue;
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
      if (validateSample(start[0], start[1]).bodyKind !== HYDROLOGY_BODY_DRY) continue;
      if (validateSample(end[0], end[1]).bodyKind !== HYDROLOGY_BODY_DRY) continue;
      const waterEntry = findWaterEntry(validateSample, start, [x, z], river.bodyId, shoreProbeSpacingM);
      if (!waterEntry) continue;
      const shoreRunM = Math.hypot(x - waterEntry[0], z - waterEntry[1]);
      if (!(shoreRunM > 0) || river.depth / shoreRunM > maxShoreGrade) continue;
      return {
        start,
        waterEntry,
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

export function findValidatedContinentRiverCrossingRoute(
  coarseSample: (x: number, z: number) => ContinentRiverRouteSample,
  runtimeSample: (x: number, z: number) => ContinentRiverRouteSample,
  options: ContinentRiverRouteSearchOptions = {},
): ContinentRiverCrossingRoute | null {
  return findContinentRiverCrossingRouteFromSample(coarseSample, options, runtimeSample);
}

export function findContinentRiverCrossingRoute(
  sample: (x: number, z: number) => ContinentRiverRouteSample,
  options: ContinentRiverRouteSearchOptions = {},
): ContinentRiverCrossingRoute | null {
  return findContinentRiverCrossingRouteFromEnvironmentQuery(
    createContinentRiverRouteEnvironmentQuery(sample),
    options,
  );
}

export function findContinentRiverCrossingRouteFromEnvironmentQuery(
  query: EnvironmentQuery,
  options: ContinentRiverRouteSearchOptions = {},
): ContinentRiverCrossingRoute | null {
  return findContinentRiverCrossingRouteFromSample((x, z) => {
    const water = query.water(x, z, CONTINENT_RIVER_ROUTE_SAMPLE_HINT_M);
    const river = query.river(x, z, CONTINENT_RIVER_ROUTE_SAMPLE_HINT_M);
    return {
      bodyKind: water.bodyKind,
      bodyId: water.bodyId ?? 0,
      depth: water.depth,
      flowX: river.flowX,
      flowZ: river.flowZ,
      terrainY: water.carvedBedY,
      waterY: water.waterY,
    };
  }, options);
}
