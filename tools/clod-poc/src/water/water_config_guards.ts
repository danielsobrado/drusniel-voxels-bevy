import type { RiverBodyConfig, WaterDebugModeId } from "./waterConfig.js";

export function isWaterDebugModeId(value: unknown): value is WaterDebugModeId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 14;
}

export function riverHasValidPoints(river: RiverBodyConfig): boolean {
  if (river.points.length >= 2) return true;
  return (river.pointsNorm?.length ?? 0) >= 2;
}
