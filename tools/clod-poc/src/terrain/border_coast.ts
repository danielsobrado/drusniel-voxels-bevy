import type { BorderCoastBandConfig, BorderCoastOceanConfig } from "./border_coast_config.js";
import { domainWarpedFbm2, ridgedFbm2, smooth01, smoothstepRange } from "./procedural_noise.js";

export type CoastShorelineKind = "beach" | "cliff";

export interface CoastProfile {
  edgeDistance: number;
  kind: CoastShorelineKind;
}

export interface CoastWorldBounds {
  cellsX: number;
  cellsZ: number;
}

export type CoastWorldSize = number | CoastWorldBounds;

const COAST_NOISE_SEED = 99173;
const SHORELINE_MEANDER_CELLS = 10;
const MAX_COAST_BLEND_CELLS = 16;
const MIN_INLAND_CORE_WORLD_FRACTION = 0.18;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function resolveWorldBounds(worldSize: CoastWorldSize): CoastWorldBounds {
  if (typeof worldSize === "number") return { cellsX: worldSize, cellsZ: worldSize };
  return { cellsX: worldSize.cellsX, cellsZ: worldSize.cellsZ };
}

function maxCoastBandCellsForWorld(worldSize: CoastWorldSize): number {
  const bounds = resolveWorldBounds(worldSize);
  const minAxisCells = Math.max(1, Math.min(bounds.cellsX, bounds.cellsZ));
  const halfMinAxisCells = Math.max(1, Math.floor(minAxisCells * 0.5));
  const inlandCoreCells = Math.max(8, Math.floor(halfMinAxisCells * MIN_INLAND_CORE_WORLD_FRACTION));
  return Math.max(1, halfMinAxisCells - inlandCoreCells - MAX_COAST_BLEND_CELLS);
}

function resolveCoastBandForWorld(config: BorderCoastBandConfig, worldSize: CoastWorldSize): BorderCoastBandConfig {
  const configuredBandCells = config.oceanStartCells + config.shoreBackshoreCells;
  const bounds = resolveWorldBounds(worldSize);
  if (bounds.cellsX <= 0 || bounds.cellsZ <= 0 || configuredBandCells <= 0) return config;

  const maxBandCells = maxCoastBandCellsForWorld(bounds);
  if (configuredBandCells <= maxBandCells) return config;

  const scale = maxBandCells / configuredBandCells;
  const oceanStartCells = Math.max(1, Math.floor(config.oceanStartCells * scale));
  const shoreBackshoreCells = Math.max(1, Math.floor(config.shoreBackshoreCells * scale));

  return {
    ...config,
    oceanStartCells,
    oceanFullDepthCells: Math.min(
      oceanStartCells,
      Math.max(0, Math.floor(config.oceanFullDepthCells * scale)),
    ),
    shoreBackshoreCells,
    shorelineCellCells: Math.max(1, Math.floor(config.shorelineCellCells * scale)),
    beach: {
      ...config.beach,
      beachShelfCells: Math.min(
        shoreBackshoreCells,
        Math.max(0, Math.floor(config.beach.beachShelfCells * scale)),
      ),
    },
    cliff: { ...config.cliff },
  };
}

export function world\u0045dgeDistance(x: number, z: number, worldSize: CoastWorldSize): number {
  const bounds = resolveWorldBounds(worldSize);
  const maxX = Math.max(0, bounds.cellsX - 1);
  const maxZ = Math.max(0, bounds.cellsZ - 1);
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  return Math.min(xi, maxX - xi, zi, maxZ - zi);
}

function shorelineMeander(x: number, z: number, edgeDistance: number, config: BorderCoastBandConfig): number {
  const coastalFade = smoothstepRange(0, Math.max(1, config.oceanStartCells), edgeDistance);
  const warp = domainWarpedFbm2(x, z, {
    scale: 0.0045,
    octaves: 4,
    persistence: 0.52,
    lacunarity: 2.05,
    warpScale: 0.0014,
    warpStrength: 90,
    seed: COAST_NOISE_SEED,
  }) * 2 - 1;
  const detail = ridgedFbm2(x + 311, z - 709, {
    scale: 0.014,
    octaves: 3,
    persistence: 0.48,
    lacunarity: 2.2,
    seed: COAST_NOISE_SEED + 17,
  }, 1.35) * 2 - 1;
  return (warp * 0.78 + detail * 0.22) * SHORELINE_MEANDER_CELLS * coastalFade;
}

function effectiveCoastDistance(x: number, z: number, config: BorderCoastBandConfig, worldSize: CoastWorldSize): number {
  const base = world\u0045dgeDistance(x, z, worldSize);
  return Math.max(0, base + shorelineMeander(x, z, base, config));
}

export function coastMask(x: number, z: number, config: BorderCoastBandConfig, worldSize: CoastWorldSize): number {
  const coast = resolveCoastBandForWorld(config, worldSize);
  const edgeDistance = effectiveCoastDistance(x, z, coast, worldSize);
  const bandEnd = coast.oceanStartCells + coast.shoreBackshoreCells;
  if (edgeDistance < 0 || edgeDistance >= bandEnd) return 0;
  if (edgeDistance >= coast.oceanStartCells) {
    const backshoreT = (edgeDistance - coast.oceanStartCells) / Math.max(1, coast.shoreBackshoreCells);
    return 1 - smooth01(backshoreT);
  }
  return 1;
}

function cliffNoise(x: number, z: number, config: BorderCoastBandConfig): number {
  const cell = Math.max(1, config.shorelineCellCells);
  const macro = domainWarpedFbm2(x, z, {
    scale: 1 / (cell * 3.5),
    octaves: 4,
    persistence: 0.55,
    lacunarity: 2.0,
    warpScale: 1 / (cell * 8),
    warpStrength: cell * 1.75,
    seed: COAST_NOISE_SEED + 101,
  });
  const ridge = ridgedFbm2(x - 157, z + 277, {
    scale: 1 / (cell * 1.9),
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.15,
    seed: COAST_NOISE_SEED + 211,
  }, 1.7);
  return Math.min(1, Math.max(0, macro * 0.62 + ridge * 0.38));
}

export function sampleCoastType(x: number, z: number, config: BorderCoastBandConfig): CoastShorelineKind {
  return sampleCoastCliffWeight(x, z, config) >= 0.55 ? "cliff" : "beach";
}

export function sampleCoastCliffWeight(x: number, z: number, config: BorderCoastBandConfig): number {
  if (x <= 0.5 && z <= 0.5) return 0;
  const n = cliffNoise(x, z, config);
  return smoothstepRange(config.cliffHeadlandThreshold - 0.16, config.cliffHeadlandThreshold + 0.22, n);
}

export function shorelineProfile(
  x: number,
  z: number,
  config: BorderCoastBandConfig,
  worldSize: CoastWorldSize,
): CoastProfile | null {
  const coast = resolveCoastBandForWorld(config, worldSize);
  const edgeDistance = effectiveCoastDistance(x, z, coast, worldSize);
  const bandEnd = coast.oceanStartCells + coast.shoreBackshoreCells;
  if (edgeDistance < 0 || edgeDistance >= bandEnd) return null;
  return { edgeDistance, kind: sampleCoastType(x, z, coast) };
}

function beachCoastHeight(
  edgeDistance: number,
  inlandHeight: number,
  coast: BorderCoastBandConfig,
  ocean: BorderCoastOceanConfig["ocean"],
): number {
  const shoreT = Math.min(1, Math.max(0, edgeDistance / Math.max(1, coast.oceanStartCells)));
  const waterline = ocean.surfaceY + coast.beach.waterlineOffset;
  const backshoreHeight = ocean.surfaceY + coast.beach.backshoreHeightAboveWater;
  const dryBeach = lerp(waterline, backshoreHeight, smooth01(shoreT));
  if (edgeDistance < coast.oceanStartCells) return dryBeach;
  const inlandTarget = Math.max(inlandHeight, waterline);
  const blendWidth = Math.max(1, coast.shoreBackshoreCells - coast.beach.beachShelfCells);
  const delayedBackshoreT = Math.min(
    1,
    Math.max(0, (edgeDistance - coast.oceanStartCells - coast.beach.beachShelfCells) / blendWidth),
  );
  return lerp(dryBeach, inlandTarget, smooth01(delayedBackshoreT));
}

function cliffCoastHeight(
  edgeDistance: number,
  inlandHeight: number,
  coast: BorderCoastBandConfig,
  ocean: BorderCoastOceanConfig["ocean"],
): number {
  const backshoreT = Math.min(
    1,
    Math.max(0, (edgeDistance - coast.oceanStartCells) / Math.max(1, coast.shoreBackshoreCells)),
  );
  const cliffCap = Math.max(
    ocean.surfaceY + coast.cliff.minHeightAboveWater,
    inlandHeight + coast.cliff.inlandBoost,
  );
  if (edgeDistance < coast.oceanStartCells) return cliffCap;
  return lerp(cliffCap, inlandHeight, smooth01(backshoreT));
}

export function applyBorderCoastShape(
  x: number,
  z: number,
  inlandHeight: number,
  config: BorderCoastOceanConfig,
  worldSize: CoastWorldSize,
): number {
  const bounds = resolveWorldBounds(worldSize);
  if (!config.enabled || bounds.cellsX <= 0 || bounds.cellsZ <= 0) return inlandHeight;

  const coast = resolveCoastBandForWorld(config.coast, bounds);
  const edgeDistance = effectiveCoastDistance(x, z, coast, bounds);
  const bandEnd = coast.oceanStartCells + coast.shoreBackshoreCells;
  const fadeCells = Math.min(coast.shoreBackshoreCells, MAX_COAST_BLEND_CELLS);
  if (edgeDistance < 0 || edgeDistance >= bandEnd + fadeCells) return inlandHeight;

  const cliffW = sampleCoastCliffWeight(x, z, coast);
  const beach = beachCoastHeight(edgeDistance, inlandHeight, coast, config.ocean);
  const cliff = cliffCoastHeight(edgeDistance, inlandHeight, coast, config.ocean);
  const shaped = lerp(beach, cliff, cliffW);

  if (edgeDistance >= bandEnd) {
    return lerp(inlandHeight, shaped, smooth01(1 - (edgeDistance - bandEnd) / fadeCells));
  }
  return shaped;
}
