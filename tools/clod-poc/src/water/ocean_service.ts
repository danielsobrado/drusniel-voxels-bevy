import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { sampleDeepOceanNormal, sampleDeepOceanWave } from "./deep_ocean_waves.js";

/** Future boat gameplay seam: deep sea outside the playable CLOD square. */
export interface OceanSampler {
  readonly worldCells: number;
  readonly surfaceY: number;
  readonly extendCells: number;
  sampleOceanHeight(x: number, z: number, time: number): number;
  sampleOceanNormal(x: number, z: number, time: number): readonly [number, number, number];
  sampleOceanCurrent(x: number, z: number, time: number): readonly [number, number, number];
  /** True only in the render-only deep-ocean ring outside the playable world. */
  isInPlayableOcean(x: number, z: number): boolean;
}

export function createDeepOceanSampler(
  worldCells: number,
  config: DeepOceanRenderConfig,
): OceanSampler {
  const extend = Math.max(1, config.extendCells);
  const surfaceY = config.surfaceY;

  return {
    worldCells,
    surfaceY,
    extendCells: extend,
    sampleOceanHeight(x, z, time) {
      if (!this.isInPlayableOcean(x, z)) return Number.NaN;
      return surfaceY + sampleDeepOceanWave(x, z, time).height;
    },
    sampleOceanNormal(x, z, time) {
      if (!this.isInPlayableOcean(x, z)) return [0, 1, 0] as const;
      return sampleDeepOceanNormal(x, z, time);
    },
    sampleOceanCurrent(x, z, time): readonly [number, number, number] {
      if (!this.isInPlayableOcean(x, z)) return [0, 0, 0] as const;
      const wave = sampleDeepOceanWave(x, z, time);
      return [wave.velocityX, 0, wave.velocityZ] as const;
    },
    isInPlayableOcean(x, z) {
      if (!config.enabled || worldCells <= 0) return false;
      const outerMin = -extend;
      const outerMax = worldCells + extend;
      if (x < outerMin || x > outerMax || z < outerMin || z > outerMax) return false;
      const insidePlayableWorld = x >= 0 && x <= worldCells && z >= 0 && z <= worldCells;
      return !insidePlayableWorld;
    },
  };
}
