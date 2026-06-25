import type { BorderCoastBandConfig, BorderCoastOceanConfig } from "./border_coast_config.js";

export type CoastShorelineKind = "beach" | "cliff";

export interface CoastProfile {
  edgeDistance: number;
  kind: CoastShorelineKind;
}

function hashPosition(x: number, z: number): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >> 13), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

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

/** 0 outside the coast band, rising toward 1 at the world edge. */
export function coastMask(x: number, z: number, config: BorderCoastBandConfig, worldCells: number): number {
  const edgeDistance = worldEdgeDistance(x, z, worldCells);
  const bandEnd = config.oceanStartCells + config.shoreBackshoreCells;
  if (edgeDistance < 0 || edgeDistance >= bandEnd) return 0;
  if (edgeDistance >= config.oceanStartCells) {
    const backshoreT = (edgeDistance - config.oceanStartCells) / Math.max(1, config.shoreBackshoreCells);
    return 1 - smooth(backshoreT);
  }
  return 1;
}

function isCliffCell(cellX: number, cellZ: number, config: BorderCoastBandConfig): boolean {
  const headlandNoise = hashPosition(cellX + 19, cellZ - 31);
  if (cellX === 0 && cellZ === 0) return false;
  return headlandNoise >= config.cliffHeadlandThreshold || (cellX + cellZ) % config.cliffModulo === 0;
}

export function sampleCoastType(x: number, z: number, config: BorderCoastBandConfig): CoastShorelineKind {
  const cell = Math.max(1, config.shorelineCellCells);
  const cellX = Math.floor(x / cell);
  const cellZ = Math.floor(z / cell);
  return isCliffCell(cellX, cellZ, config) ? "cliff" : "beach";
}

/** Bilinear cliff weight (0=beach, 1=cliff) so shoreline macro-cells weld across chunk/page seams. */
export function sampleCoastCliffWeight(x: number, z: number, config: BorderCoastBandConfig): number {
  const cell = Math.max(1, config.shorelineCellCells);
  const cx = x / cell;
  const cz = z / cell;
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const tx = cx - x0;
  const tz = cz - z0;
  const w00 = isCliffCell(x0, z0, config) ? 1 : 0;
  const w10 = isCliffCell(x0 + 1, z0, config) ? 1 : 0;
  const w01 = isCliffCell(x0, z0 + 1, config) ? 1 : 0;
  const w11 = isCliffCell(x0 + 1, z0 + 1, config) ? 1 : 0;
  const a = w00 * (1 - tx) + w10 * tx;
  const b = w01 * (1 - tx) + w11 * tx;
  return a * (1 - tz) + b * tz;
}

export function shorelineProfile(
  x: number,
  z: number,
  config: BorderCoastBandConfig,
  worldCells: number,
): CoastProfile | null {
  const edgeDistance = worldEdgeDistance(x, z, worldCells);
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
  const dryBeach = lerp(waterline, backshoreHeight, smooth(shoreT));
  if (edgeDistance < coast.oceanStartCells) return dryBeach;
  const inlandTarget = Math.max(inlandHeight, waterline);
  const blendWidth = Math.max(1, coast.shoreBackshoreCells - coast.beach.beachShelfCells);
  const delayedBackshoreT = Math.min(
    1,
    Math.max(0, (edgeDistance - coast.oceanStartCells - coast.beach.beachShelfCells) / blendWidth),
  );
  return lerp(dryBeach, inlandTarget, smooth(delayedBackshoreT));
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
  return lerp(cliffCap, inlandHeight, smooth(backshoreT));
}

export function applyBorderCoastShape(
  x: number,
  z: number,
  inlandHeight: number,
  config: BorderCoastOceanConfig,
  worldCells: number,
): number {
  if (!config.enabled || worldCells <= 0) return inlandHeight;

  const edgeDistance = worldEdgeDistance(x, z, worldCells);
  const bandEnd = config.coast.oceanStartCells + config.coast.shoreBackshoreCells;
  const fadeCells = Math.min(config.coast.shoreBackshoreCells, 16);
  if (edgeDistance < 0 || edgeDistance >= bandEnd + fadeCells) return inlandHeight;

  const cliffW = sampleCoastCliffWeight(x, z, config.coast);
  const beach = beachCoastHeight(edgeDistance, inlandHeight, config.coast, config.ocean);
  const cliff = cliffCoastHeight(edgeDistance, inlandHeight, config.coast, config.ocean);
  const shaped = lerp(beach, cliff, cliffW);

  if (edgeDistance >= bandEnd) {
    return lerp(inlandHeight, shaped, smooth(1 - (edgeDistance - bandEnd) / fadeCells));
  }
  return shaped;
}
