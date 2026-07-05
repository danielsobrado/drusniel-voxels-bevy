import type { FarClipmapConfig } from "./far_clipmap_config.js";

export interface FarClipmapSnap {
  centerX: number;
  centerZ: number;
  snapX: number;
  snapZ: number;
}

export interface FarClipmapRingRange {
  ring: number;
  innerRadiusM: number;
  outerRadiusM: number;
  cellSizeM: number;
}

export function snapFarClipmapCoord(value: number, snapSizeM: number): number {
  const snap = Math.max(1, snapSizeM);
  return Math.floor(value / snap) * snap;
}

export function farClipmapSnap(centerX: number, centerZ: number, snapSizeM: number): FarClipmapSnap {
  return {
    centerX,
    centerZ,
    snapX: snapFarClipmapCoord(centerX, snapSizeM),
    snapZ: snapFarClipmapCoord(centerZ, snapSizeM),
  };
}

export function farClipmapTileKey(ring: number, snapX: number, snapZ: number): string {
  return "R" + String(ring) + ":" + String(snapX) + "," + String(snapZ);
}

export function farClipmapRingCellSize(baseCellSizeM: number, ring: number): number {
  return Math.max(1, baseCellSizeM) * 2 ** Math.max(0, ring);
}

export function farClipmapRingRange(config: FarClipmapConfig, ring: number): FarClipmapRingRange {
  const safeRing = Math.max(0, Math.min(config.ringCount - 1, ring));
  const span = Math.max(config.baseCellSizeM, config.outerRadiusM - config.innerRadiusM);
  const startT = safeRing / config.ringCount;
  const endT = (safeRing + 1) / config.ringCount;
  return {
    ring: safeRing,
    innerRadiusM: config.innerRadiusM + span * startT,
    outerRadiusM: config.innerRadiusM + span * endT,
    cellSizeM: farClipmapRingCellSize(config.baseCellSizeM, safeRing),
  };
}

export function farClipmapTileKeysForSnap(config: FarClipmapConfig, snap: FarClipmapSnap): string[] {
  const keys: string[] = [];
  for (let ring = 0; ring < config.ringCount; ring++) {
    keys.push(farClipmapTileKey(ring, snap.snapX, snap.snapZ));
  }
  return keys;
}
