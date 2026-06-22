import type { HydrologyMoistureConfig } from "./hydrologyConfig.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_RIVER,
  gridIndex,
  triangleBlur,
  type HydrologyGrid,
} from "./hydrologyGrid.js";

export function buildMoistureField(grid: HydrologyGrid, config: HydrologyMoistureConfig): void {
  const { moisture, bodyKind } = grid;
  moisture.fill(0);
  if (!config.enabled) return;

  for (let i = 0; i < moisture.length; i++) {
    let source = 0;
    if (bodyKind[i] === HYDROLOGY_BODY_RIVER) {
      source = config.riverSource;
    } else if (bodyKind[i] === HYDROLOGY_BODY_LAKE) {
      source = config.lakeSource;
    } else if (bodyKind[i] === HYDROLOGY_BODY_MARSH) {
      source = config.marshSource;
    } else if (grid.wetMask[i] > 0.5) {
      source = config.lakeSource;
    }
    moisture[i] = finite01(source);
  }

  const radius = Math.max(0, Math.floor(config.blurRadius));
  if (radius > 0) triangleBlur(moisture, grid.res, radius);
  const dryDecay = finite01(config.dryDecay);
  for (let z = 0; z < grid.res; z++) {
    for (let x = 0; x < grid.res; x++) {
      const i = gridIndex(grid.res, x, z);
      const wetBoost = grid.wetMask[i] > 0.5 ? 1 : dryDecay;
      moisture[i] = finite01(moisture[i] * wetBoost);
    }
  }
}

function finite01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
