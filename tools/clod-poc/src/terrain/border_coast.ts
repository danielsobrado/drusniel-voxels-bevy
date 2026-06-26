import type { BorderCoastBandConfig, BorderCoastOceanConfig } from "./border_coast_config.js";
import { domainWarpedFbm2, ridgedFbm2, smooth01, smoothstepRange } from "./procedural_noise.js";

export type CoastShorelineKind = "beach" | "cliff";

export interface CoastProfile {
  edgeDistance: number;
  kind: CoastShorelineKind;
}

const COAST_NOISE_SEED = 99173;
const SHORELINE_MEANDER_CELLS = 10;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
  const edgeDistance = effectiveCoastDistance(x, z, config, worldCells);
  const bandEnd = config.oceanStartCells + config.shoreBackshoreCells;
  if (edgeDistance < 0 || edgeDistance >= bandEnd) return 0;
  if (edgeDistance >= config.oceanStartCells) {
    const backshoreT = (edgeDistance - config.oceanStartCells) / Math.max(1, config.shoreBackshoreCells);
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
  const edgeDistance = effectiveCoastDistance(x, z, config, worldCells);
  const bandEnd = config.oceanStartCells + config.shoreBackshoreCells;
  if (edgeDistance < 0 || edgeDistance >= bandEnd) return null;
  return { edgeDistance, kind: sampleCoastType(x, z, config) };
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
  worldCells: number,
): number {
  if (!config.enabled || worldCells <= 0) return inlandHeight;

  const edgeDistance = effectiveCoastDistance(x, z, config.coast, worldCells);
  const bandEnd = config.coast.oceanStartCells + config.coast.shoreBackshoreCells;
  const fadeCells = Math.min(config.coast.shoreBackshoreCells, 16);
  if (edgeDistance < 0 || edgeDistance >= bandEnd + fadeCells) return inlandHeight;

  const cliffW = sampleCoastCliffWeight(x, z, config.coast);
  const beach = beachCoastHeight(edgeDistance, inlandHeight, config.coast, config.ocean);
  const cliff = cliffCoastHeight(edgeDistance, inlandHeight, config.coast, config.ocean);
  const shaped = lerp(beach, cliff, cliffW);

  if (edgeDistance >= bandEnd) {
    return lerp(inlandHeight, shaped, smooth01(1 - (edgeDistance - bandEnd) / fadeCells));
  }
  return shaped;
}
