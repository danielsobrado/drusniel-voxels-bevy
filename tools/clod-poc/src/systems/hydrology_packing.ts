import type { UnderstoryHydrologyData } from "../gpu/understory_ring_compute.js";
import {
  packHydrologyFieldsTexels,
  packHydrologyWaterSurfaceTexels,
  type HydrologyWaterSurfaceFields,
} from "../water/hydrologyGpuPacking.js";
import type { HydrologyGrid } from "../water/hydrologyGrid.js";

/** Canonical Layout A upload: waterY, wetMask, carvedBedY, shoreDistance. */
export function packHydrologyData(hydrology: {
  grid: HydrologyWaterSurfaceFields & { worldCells: number };
}): UnderstoryHydrologyData {
  const { res, worldCells } = hydrology.grid;
  return { res, worldCells, data: packHydrologyWaterSurfaceTexels(hydrology.grid) };
}

/** Canonical Layout B upload: flow XY, moisture, normalized body kind. */
export function packHydrologyFieldData(hydrology: {
  grid: HydrologyGrid;
}): UnderstoryHydrologyData {
  const { res, worldCells } = hydrology.grid;
  return { res, worldCells, data: packHydrologyFieldsTexels(hydrology.grid) };
}
