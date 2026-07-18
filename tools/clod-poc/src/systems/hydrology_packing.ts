import type { UnderstoryHydrologyData } from "../gpu/understory_ring_compute.js";
import { gravelBarBodyPhase } from "../water/gravel_bar_field.js";
import {
  packHydrologyWaterSurfaceTexels,
  type HydrologyWaterSurfaceFields,
} from "../water/hydrologyGpuPacking.js";
import type { HydrologyGrid } from "../water/hydrologyGrid.js";

const BODY_PHASE_LANE_SCALE = 0.25;
const BODY_KIND_NORMALIZATION = 255;

/** Canonical Layout A upload: waterY, wetMask, carvedBedY, shoreDistance. */
export function packHydrologyData(hydrology: {
  grid: HydrologyWaterSurfaceFields & { worldCells: number };
}): UnderstoryHydrologyData {
  const { res, worldCells } = hydrology.grid;
  return { res, worldCells, data: packHydrologyWaterSurfaceTexels(hydrology.grid) };
}

/** Stone-only Layout B upload: flow XY pre-scaled by strength, flow strength, and body
 * kind with a sub-half-unit gravel phase. Round-to-kind decoders remain compatible. */
export function packHydrologyFieldData(hydrology: {
  grid: HydrologyGrid;
}): UnderstoryHydrologyData {
  const { grid } = hydrology;
  const data = new Float32Array(grid.res * grid.res * 4);
  for (let index = 0; index < grid.res * grid.res; index += 1) {
    const flowStrength = Math.max(0, grid.flowStrength[index]);
    data[index * 4] = grid.flowDirX[index] * flowStrength;
    data[index * 4 + 1] = grid.flowDirZ[index] * flowStrength;
    data[index * 4 + 2] = flowStrength;
    const bodyPhase = gravelBarBodyPhase(grid.bodyId[index]);
    data[index * 4 + 3] = (grid.bodyKind[index] + bodyPhase * BODY_PHASE_LANE_SCALE)
      / BODY_KIND_NORMALIZATION;
  }
  return { res: grid.res, worldCells: grid.worldCells, data };
}
