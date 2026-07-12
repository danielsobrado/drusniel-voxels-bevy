import { baseSurfaceHeight, type TerrainSurfaceOverride } from "./terrain_surface.js";

// Explicit startup-world heightfield raster cache (NOT a hydrology-carve side effect).
//
// The cache stores exact procedural heights at integer cell corners. Surface Nets density
// corners are integer lattice reads, so they can use the cached f64 samples without changing
// geometry. Fractional samples intentionally bypass the raster and evaluate the canonical
// procedural field directly. This keeps normals, prop placement, colliders, raycasts, and the
// GPU streamed-root field on the same sampling policy and avoids a derivative discontinuity at
// the raster boundary.

export const STARTUP_HEIGHTFIELD_PADDING_CELLS = 2;
export const STARTUP_HEIGHTFIELD_BYTES_PER_SAMPLE = Float64Array.BYTES_PER_ELEMENT;
export const STARTUP_HEIGHTFIELD_DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const STARTUP_HEIGHTFIELD_DEFAULT_MAX_SAMPLES = Math.floor(
  STARTUP_HEIGHTFIELD_DEFAULT_MAX_BYTES / STARTUP_HEIGHTFIELD_BYTES_PER_SAMPLE,
);
export const STARTUP_HEIGHTFIELD_SAMPLING_MODE = "integer_lattice_only" as const;

export interface StartupHeightfieldLimits {
  maxBytes?: number;
  maxSamples?: number;
}

export type StartupHeightfieldPlanReason = "enabled" | "invalid_world_cells" | "sample_budget" | "byte_budget";

export interface StartupHeightfieldPlan {
  worldCells: number;
  minCell: number;
  res: number;
  sampleCount: number;
  byteLength: number;
  enabled: boolean;
  reason: StartupHeightfieldPlanReason;
}

export interface StartupHeightfieldRaster {
  worldCells: number;
  minCell: number;
  res: number;
  sampleCount: number;
  byteLength: number;
  samplingMode: typeof STARTUP_HEIGHTFIELD_SAMPLING_MODE;
  heights: Float64Array;
}

export interface StartupHeightfieldDescriptor {
  worldCells: number;
  minCell: number;
  res: number;
  sampleCount: number;
  byteLength: number;
  samplingMode: typeof STARTUP_HEIGHTFIELD_SAMPLING_MODE;
}

function finiteBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function planStartupHeightfieldRaster(
  worldCells: number,
  limits: StartupHeightfieldLimits = {},
): StartupHeightfieldPlan {
  const normalizedWorldCells = Math.floor(worldCells);
  const minCell = -STARTUP_HEIGHTFIELD_PADDING_CELLS;
  if (!Number.isFinite(worldCells) || normalizedWorldCells <= 0 || normalizedWorldCells !== worldCells) {
    return {
      worldCells: normalizedWorldCells,
      minCell,
      res: 0,
      sampleCount: 0,
      byteLength: 0,
      enabled: false,
      reason: "invalid_world_cells",
    };
  }

  const res = normalizedWorldCells + STARTUP_HEIGHTFIELD_PADDING_CELLS * 2 + 1;
  const sampleCount = res * res;
  const byteLength = sampleCount * STARTUP_HEIGHTFIELD_BYTES_PER_SAMPLE;
  const maxSamples = finiteBudget(limits.maxSamples, STARTUP_HEIGHTFIELD_DEFAULT_MAX_SAMPLES);
  const maxBytes = finiteBudget(limits.maxBytes, STARTUP_HEIGHTFIELD_DEFAULT_MAX_BYTES);
  const reason: StartupHeightfieldPlanReason = sampleCount > maxSamples
    ? "sample_budget"
    : byteLength > maxBytes
      ? "byte_budget"
      : "enabled";

  return {
    worldCells: normalizedWorldCells,
    minCell,
    res,
    sampleCount,
    byteLength,
    enabled: reason === "enabled",
    reason,
  };
}

export function buildStartupHeightfieldRaster(
  worldCells: number,
  sample: (x: number, z: number) => number = baseSurfaceHeight,
  limits: StartupHeightfieldLimits = {},
): StartupHeightfieldRaster | null {
  const plan = planStartupHeightfieldRaster(worldCells, limits);
  if (!plan.enabled) return null;

  const heights = new Float64Array(plan.sampleCount);
  for (let iz = 0; iz < plan.res; iz++) {
    const z = plan.minCell + iz;
    const row = iz * plan.res;
    for (let ix = 0; ix < plan.res; ix++) heights[row + ix] = sample(plan.minCell + ix, z);
  }
  return {
    worldCells: plan.worldCells,
    minCell: plan.minCell,
    res: plan.res,
    sampleCount: plan.sampleCount,
    byteLength: plan.byteLength,
    samplingMode: STARTUP_HEIGHTFIELD_SAMPLING_MODE,
    heights,
  };
}

export function cloneStartupHeightfieldRaster(raster: StartupHeightfieldRaster): StartupHeightfieldRaster {
  const heights = raster.heights.slice();
  return { ...raster, heights, byteLength: heights.byteLength, sampleCount: heights.length };
}

export function startupHeightfieldDescriptor(
  raster: StartupHeightfieldRaster | null,
): StartupHeightfieldDescriptor | null {
  if (!raster) return null;
  return {
    worldCells: raster.worldCells,
    minCell: raster.minCell,
    res: raster.res,
    sampleCount: raster.sampleCount,
    byteLength: raster.byteLength,
    samplingMode: raster.samplingMode,
  };
}

export function makeStartupHeightfieldSampler(raster: StartupHeightfieldRaster): TerrainSurfaceOverride {
  const { minCell, res, heights } = raster;
  const maxCell = minCell + res - 1;
  return (x, z) => {
    if (!Number.isInteger(x) || !Number.isInteger(z)) return baseSurfaceHeight(x, z);
    if (x < minCell || z < minCell || x > maxCell || z > maxCell) return baseSurfaceHeight(x, z);
    return heights[(z - minCell) * res + (x - minCell)]!;
  };
}
