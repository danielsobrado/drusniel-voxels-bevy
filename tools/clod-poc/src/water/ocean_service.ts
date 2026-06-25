import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";

/** Future boat gameplay seam: deep sea outside the playable CLOD square. */
export interface OceanSampler {
  readonly worldCells: number;
  readonly surfaceY: number;
  readonly extendCells: number;
  sampleOceanHeight(x: number, z: number, time: number): number;
  sampleOceanNormal(x: number, z: number, time: number): readonly [number, number, number];
  sampleOceanCurrent(x: number, z: number, time: number): readonly [number, number, number];
  /** True in the render-only deep-ocean band outside world bounds (future boat zone). */
  isInPlayableOcean(x: number, z: number): boolean;
}

function rippleHeight(x: number, z: number, time: number): number {
  const t = time * 0.55;
  return Math.sin(x * 0.07 + t) * 0.18 + Math.cos(z * 0.06 - t * 0.8) * 0.14;
}

function rippleNormal(x: number, z: number, time: number): readonly [number, number, number] {
  const eps = 0.35;
  const h = rippleHeight(x, z, time);
  const hx = rippleHeight(x + eps, z, time);
  const hz = rippleHeight(x, z + eps, time);
  const dx = (hx - h) / eps;
  const dz = (hz - h) / eps;
  const len = Math.hypot(dx, 1, dz);
  return [-dx / len, 1 / len, -dz / len];
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
      if (!config.enabled) return surfaceY;
      return surfaceY + rippleHeight(x, z, time);
    },
    sampleOceanNormal(x, z, time) {
      if (!config.enabled) return [0, 1, 0] as const;
      return rippleNormal(x, z, time);
    },
    sampleOceanCurrent(_x, _z, _time): readonly [number, number, number] {
      return [0, 0, 0];
    },
    isInPlayableOcean(x, z) {
      if (!config.enabled || worldCells <= 0) return false;
      const outerMin = -extend;
      const outerMax = worldCells + extend;
      const outsideX = x < 0 || x > worldCells;
      const outsideZ = z < 0 || z > worldCells;
      if (!outsideX && !outsideZ) return false;
      return x >= outerMin && x <= outerMax && z >= outerMin && z <= outerMax;
    },
  };
}
