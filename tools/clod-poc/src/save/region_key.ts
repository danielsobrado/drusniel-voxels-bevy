import { SAVE_REGION_SIZE_M } from "./save_config.js";

export const REGION_SIZE_M = SAVE_REGION_SIZE_M;

export function regionCoord(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`region coordinate must be finite: ${value}`);
  return Math.floor(value / REGION_SIZE_M);
}

export function regionKeyOf(rx: number, rz: number): string {
  if (!Number.isSafeInteger(rx) || !Number.isSafeInteger(rz)) {
    throw new Error(`region key coordinates must be safe integers: ${rx}, ${rz}`);
  }
  return `r_${rx}_${rz}`;
}

export function parseRegionKey(regionKey: string): { rx: number; rz: number } {
  const parts = regionKey.split("_");
  if (parts.length !== 3 || parts[0] !== "r") throw new Error(`invalid region key: ${regionKey}`);
  const rx = Number(parts[1]);
  const rz = Number(parts[2]);
  if (!Number.isSafeInteger(rx) || !Number.isSafeInteger(rz)) throw new Error(`invalid region key: ${regionKey}`);
  return { rx, rz };
}

export function regionKeyForWorld(x: number, z: number): string {
  return regionKeyOf(regionCoord(x), regionCoord(z));
}

export function l0PageRangeForRegion(rx: number, rz: number): { minPx: number; maxPx: number; minPz: number; maxPz: number } {
  if (!Number.isSafeInteger(rx) || !Number.isSafeInteger(rz)) {
    throw new Error(`region page range coordinates must be safe integers: ${rx}, ${rz}`);
  }
  return {
    minPx: rx * 8,
    maxPx: rx * 8 + 7,
    minPz: rz * 8,
    maxPz: rz * 8 + 7,
  };
}
