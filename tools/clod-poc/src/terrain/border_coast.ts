import type { BorderCoastBandConfig, BorderCoastOceanConfig } from "./border_coast_config.js";
import { domainWarpedFbm2, ridgedFbm2, smooth01, smoothstepRange } from "./procedural_noise.js";

export type CoastShorelineKind = "beach" | "cliff";

export interface CoastProfile {
  edgeDistance: number;
  kind: CoastShorelineKind;
}

const COAST_NOISE_SEED = 99173;
const SHORELINE_MEANDER_CELLS = 10;
const MAX_COAST_BLEND_CELLS = 16;
const MIN_INLAND_CORE_WORLD_FRACTION = 0.18;
const BEACH_HIGHLAND_START_ABOVE_BACKSHORE = 6;
const BEACH_HIGHLAND_FULL_EXTRA_CELLS = 12;
const BEACH_HIGHLAND_PRESERVE_SHORE_FRACTION = 0.72;
const BEACH_DRY_INFLUENCE_SHELF_FRACTION = 0.85;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function maxCoastBandCellsForWorld(worldCells: number): number {
  const halfWorldCells = Math.max(1, Math.floor(worldCells * 0.5));
  const inlandCoreCells = Math.max(8, Math.floor(halfWorldCells * MIN_INLAND_CORE_WORLD_FRACTION));
  return Math.max(1, halfWorldCells - inlandCoreCells - MAX_COAST_BLEND_CELLS);
}

function resolveCoastBandForWorld(config: BorderCoastBandConfig, worldCells: number): BorderCoastBandConfig {
  const configuredBandCells = config.oceanStartCells + config.shoreBackshoreCells;
  if (worldCells <= 0 || configuredBandCells <= 0) return config;

  const maxBandCells = maxCoastBandCellsForWorld(worldCells);
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

/** Cells from the nearest playable world edge (0 = on the border). */
export function worldEdgeDistance(x: number, z: number, worldCells: number): number {
  const max = Math.max(0, worldCells - 1);
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  return Math.min(xi, max - xi, zi, max - zi);
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

function effectiveCoastDistance(x: number, z: number, config: BorderCoastBandConfig, worldCells: number): number {
  const base = worldEdgeDistance(x, z, worldCells);
  return Math.max(0, base + shorelineMeander(x, z, base, config));
}

/** 0 outside the coast band, rising toward 1 at the world edge. */
export function coastMask(x: number, z: number, config: BorderCoastBandConfig, worldCells: number): number {
  const coast = resolveCoastBandForWorld(config, worldCells);
  const edgeDistance = effectiveCoastDistance(x, z, coast, worldCells);
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

/** Continuous cliff weight (0=beach, 1=cliff), generated with domain-warped FBM. */
export function sampleCoastCliffWeight(x: number, z: number, config: BorderCoastBandConfig): number {
  if (x <= 0.5 && z <= 0.5) return 0;
  const n = cliffNoise(x, z, config);
  return smoothstepRange(config.cliffHeadlandThreshold - 0.16, config.cliffHeadlandThreshold + 0.22, n);
}

export function shorelineProfile(
  x: number,
  z: number,
  config: BorderCoastBandConfig,
  worldCells: number,
): CoastProfile | null {
  const coast = resolveCoastBandForWorld(config, worldCells);
  const edgeDistance = effectiveCoastDistance(x, z, coast, worldCells);
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

function beachShoreInfluence(edgeDistance: number, coast: BorderCoastBandConfig): number {
  const shelf = Math.max(1, coast.beach.beachShelfCells);
  const fadeStart = coast.oceanStartCells + shelf * BEACH_DRY_INFLUENCE_SHELF_FRACTION;
  const fadeEnd = coast.oceanStartCells + shelf;
  return 1 - smoothstepRange(fadeStart, fadeEnd, edgeDistance);
}

function beachHighlandPreserveWeight(
  edgeDistance: number,
  inlandHeight: number,
  coast: BorderCoastBandConfig,
  ocean: BorderCoastOceanConfig["ocean"],
): number {
  const backshoreHeight = ocean.surfaceY + coast.beach.backshoreHeightAboveWater;
  const startHeight = backshoreHeight + BEACH_HIGHLAND_START_ABOVE_BACKSHORE;
  const fullHeight = Math.max(
    startHeight + BEACH_HIGHLAND_FULL_EXTRA_CELLS,
    ocean.surfaceY + coast.cliff.minHeightAboveWater + coast.cliff.inlandBoost,
  );
  const highland = smoothstepRange(startHeight, fullHeight, inlandHeight);
  const drySide = smoothstepRange(
    coast.oceanStartCells * BEACH_HIGHLAND_PRESERVE_SHORE_FRACTION,
    coast.oceanStartCells + Math.max(1, coast.beach.beachShelfCells),
    edgeDistance,
  );
  return highland * drySide;
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
  worldCells: number,
): number {
  if (!config.enabled || worldCells <= 0) return inlandHeight;

  const coast = resolveCoastBandForWorld(config.coast, worldCells);
  const edgeDistance = effectiveCoastDistance(x, z, coast, worldCells);
  const bandEnd = coast.oceanStartCells + coast.shoreBackshoreCells;
  const fadeCells = Math.min(coast.shoreBackshoreCells, MAX_COAST_BLEND_CELLS);
  if (edgeDistance < 0 || edgeDistance >= bandEnd + fadeCells) return inlandHeight;

  const cliffW = sampleCoastCliffWeight(x, z, coast);
  const rawBeach = beachCoastHeight(edgeDistance, inlandHeight, coast, config.ocean);
  const beachReach = beachShoreInfluence(edgeDistance, coast);
  const beach = lerp(inlandHeight, rawBeach, beachReach);
  const cliff = cliffCoastHeight(edgeDistance, inlandHeight, coast, config.ocean);
  const shaped = lerp(beach, cliff, cliffW);
  const beachW = 1 - cliffW;
  const preserveHighland = beachW * beachHighlandPreserveWeight(edgeDistance, inlandHeight, coast, config.ocean);
  const protectedShape = lerp(shaped, inlandHeight, preserveHighland);

  if (edgeDistance >= bandEnd) {
    return lerp(inlandHeight, protectedShape, smooth01(1 - (edgeDistance - bandEnd) / fadeCells));
  }
  return protectedShape;
}
