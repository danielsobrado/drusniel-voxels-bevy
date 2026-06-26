import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { sampleDeepOceanCurrent, sampleDeepOceanNormal, sampleDeepOceanWave } from "./deep_ocean_waves.js";

/** Future boat gameplay seam: deep sea around the playable CLOD square. */
export interface OceanSampler {
  readonly worldCells: number;
  readonly surfaceY: number;
  readonly extendCells: number;
  sampleOceanHeight(x: number, z: number, time: number): number;
  sampleOceanNormal(x: number, z: number, time: number): readonly [number, number, number];
  sampleOceanCurrent(x: number, z: number, time: number): readonly [number, number, number];
  /** True in the render-only deep-ocean ring around the world border. */
  isInPlayableOcean(x: number, z: number): boolean;
}

export function createDeepOceanSampler(
  worldCells: number,
  config: DeepOceanRenderConfig,
  innerBandCells = 0,
): OceanSampler {
  const extend = Math.max(1, config.extendCells);
  const surfaceY = config.surfaceY;
  const innerBand = Math.min(Math.max(0, innerBandCells), worldCells * 0.5);

  return {
    worldCells,
    surfaceY,
    extendCells: extend,
    sampleOceanHeight(x, z, time) {
      if (!config.enabled) return surfaceY;
      return surfaceY + sampleDeepOceanWave(x, z, time).dy;
    },
    sampleOceanNormal(x, z, time) {
      if (!config.enabled) return [0, 1, 0] as const;
      return sampleDeepOceanNormal(x, z, time);
    },
    sampleOceanCurrent(x, z, time): readonly [number, number, number] {
      if (!config.enabled) return [0, 0, 0] as const;
      return sampleDeepOceanCurrent(x, z, time);
    },
    isInPlayableOcean(x, z) {
      if (!config.enabled || worldCells <= 0) return false;
      const outerMin = -extend;
      const outerMax = worldCells + extend;
      if (x < outerMin || x > outerMax || z < outerMin || z > outerMax) return false;
      const insideCore = x > innerBand && x < worldCells - innerBand && z > innerBand && z < worldCells - innerBand;
      return !insideCore;
    },
  };
}
