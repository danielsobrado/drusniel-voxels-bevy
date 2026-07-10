import type { UnderstoryHydrologyData } from "../gpu/understory_ring_compute.js";
import {
  packHydrologyWaterSurfaceTexels,
  type HydrologyWaterSurfaceFields,
} from "../water/hydrologyGpuPacking.js";

/**
 * Understory/vegetation ring-compute hydrology upload. Uses the canonical Layout A texel
 * packing (R=waterY, G=wetMask, B=carvedBedY, A=shoreDistance) defined in
 * hydrologyGpuPacking.ts — do not fork the channel layout here.
 */
export function packHydrologyData(hydrology: {
  grid: HydrologyWaterSurfaceFields & { worldCells: number };
}): UnderstoryHydrologyData {
  const { res, worldCells } = hydrology.grid;
  return { res, worldCells, data: packHydrologyWaterSurfaceTexels(hydrology.grid) };
}
