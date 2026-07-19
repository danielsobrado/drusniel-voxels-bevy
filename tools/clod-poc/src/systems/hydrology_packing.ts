import type { UnderstoryHydrologyData } from "../gpu/understory_ring_compute.js";
import { gravelBarBodyPhase } from "../water/gravel_bar_field.js";
import {
  packHydrologyFieldsTexels,
  packHydrologyWaterSurfaceTexels,
  type HydrologyWaterSurfaceFields,
} from "../water/hydrologyGpuPacking.js";
import type { HydrologyGrid } from "../water/hydrologyGrid.js";

const BODY_PHASE_LANE_SCALE = 0.25;
const BODY_KIND_NORMALIZATION = 255;

export function packHydrologyData(hydrology: {
  grid: HydrologyWaterSurfaceFields & { worldCells: number };
}): UnderstoryHydrologyData {
  const { res, worldCells } = hydrology.grid;
  return { res, worldCells, data: packHydrologyWaterSurfaceTexels(hydrology.grid) };
}

export function packHydrologyFieldData(hydrology: {
  grid: HydrologyGrid;
}): UnderstoryHydrologyData {
  const { grid } = hydrology;
  const data = packHydrologyFieldsTexels(grid);
  for (let index = 0; index < grid.res * grid.res; index += 1) {
    data[index * 4 + 3] = (
      grid.bodyKind[index]
      + gravelBarBodyPhase(grid.bodyId[index]) * BODY_PHASE_LANE_SCALE
    ) / BODY_KIND_NORMALIZATION;
  }
  return { res: grid.res, worldCells: grid.worldCells, data };
}
