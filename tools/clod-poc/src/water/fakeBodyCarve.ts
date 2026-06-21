import type { TerrainHeightSampler } from "./waterField.js";
import type { WaterConfig } from "./waterConfig.js";

const LAKE_BASIN_DEPTH = 5.0;
const RIVER_CHANNEL_DEPTH = 3.2;

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function makeFakeBodyCarvedSampler(config: WaterConfig, sampler: TerrainHeightSampler): TerrainHeightSampler {
  if (!config.fakeBodies.carveTerrain) return sampler;
  return {
    surfaceHeight: (x: number, z: number) => {
      let height = sampler.surfaceHeight(x, z);
      for (const lake of config.fakeBodies.lakes) {
        const rx = Math.max(0.001, lake.radius[0]);
        const rz = Math.max(0.001, lake.radius[1]);
        const nx = (x - lake.center[0]) / rx;
        const nz = (z - lake.center[1]) / rz;
        const r = Math.sqrt(nx * nx + nz * nz);
        if (r < 1) {
          const basin = 1 - smoothstep(0.62, 1.0, r);
          height -= LAKE_BASIN_DEPTH * basin;
        }
      }
      for (const river of config.fakeBodies.rivers) {
        if (river.points.length < 2) continue;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < river.points.length - 1; i++) {
          const a = river.points[i];
          const b = river.points[i + 1];
          bestDist = Math.min(bestDist, pointSegmentDistance(x, z, a[0], a[1], b[0], b[1]));
        }
        const halfWidth = Math.max(0.05, river.width * 0.5);
        if (bestDist < halfWidth * 1.8) {
          const channel = 1 - smoothstep(halfWidth * 0.35, halfWidth * 1.8, bestDist);
          height -= RIVER_CHANNEL_DEPTH * channel;
        }
      }
      return height;
    },
  };
}
