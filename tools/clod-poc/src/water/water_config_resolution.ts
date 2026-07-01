import type { WaterConfig } from "./waterConfig.js";

export type CloneWaterConfig = (config: WaterConfig) => WaterConfig;

export function resolveNormalizedFakeBodies(
  config: WaterConfig,
  worldCells: number,
  clone: CloneWaterConfig,
): WaterConfig {
  const resolved = clone(config);
  for (const lake of resolved.fakeBodies.lakes) {
    if (lake.centerNorm) {
      lake.center = [lake.centerNorm[0] * worldCells, lake.centerNorm[1] * worldCells];
    }
  }
  for (const river of resolved.fakeBodies.rivers) {
    if (river.pointsNorm) {
      river.points = river.pointsNorm.map((point) => [point[0] * worldCells, point[1] * worldCells]);
    }
  }
  return resolved;
}
