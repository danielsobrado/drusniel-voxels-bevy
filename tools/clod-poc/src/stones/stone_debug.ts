// Debug sampling for the stone overlay: evaluate the placement fields on a grid so the viewer
// can render accepted/rejected and per-field (streambed / scree / cliffAbove / rockExposure)
// heatmaps. Pure functions over the same terrain readout the scatter uses.

import { hash2 } from "./stone_hash.js";
import type { StoneSettings } from "./stone_config.js";
import { ACCEPT_SALT, sampleStoneSite, stoneWeight, type StoneSiteSample } from "./stone_scatter.js";

export const STONE_DEBUG_FIELDS = [
  "accepted",
  "weight",
  "rockExposure",
  "scree",
  "streambed",
  "cliffAbove",
  "snow",
] as const;

export type StoneDebugField = typeof STONE_DEBUG_FIELDS[number];

/** Value in [0,1] for a debug field at a world position. */
export function stoneDebugValue(
  field: StoneDebugField,
  x: number,
  z: number,
  settings: StoneSettings,
  site: StoneSiteSample = sampleStoneSite(x, z, settings),
): number {
  switch (field) {
    case "accepted": {
      const weight = stoneWeight(site, settings, x, z);
      const gx = Math.floor(x / settings.cellSizeM);
      const gz = Math.floor(z / settings.cellSizeM);
      return weight > 0 && hash2(gx, gz, settings.seedSalt + ACCEPT_SALT) < weight ? 1 : 0;
    }
    case "weight":
      return Math.min(1, stoneWeight(site, settings, x, z));
    case "rockExposure":
      return site.rockExposure;
    case "scree":
      return site.scree;
    case "streambed":
      return site.streambed;
    case "cliffAbove":
      return site.cliffAbove;
    case "snow":
      return site.snow;
  }
}

/** Blue→green→red ramp for a [0,1] heatmap value. */
export function heatColor(value: number): [number, number, number] {
  const v = Math.min(1, Math.max(0, value));
  if (v < 0.5) return [0, v * 2, 1 - v * 2];
  return [(v - 0.5) * 2, 1 - (v - 0.5) * 2, 0];
}
