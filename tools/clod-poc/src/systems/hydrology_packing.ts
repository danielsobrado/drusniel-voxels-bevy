import type { UnderstoryHydrologyData } from "../gpu/understory_ring_compute.js";

export function packHydrologyData(hydrology: {
  grid: {
    res: number;
    worldCells: number;
    waterY: Float32Array;
    wetMask: Float32Array;
    carvedBed: Float32Array;
  };
}): UnderstoryHydrologyData {
  const { res, worldCells, waterY, wetMask, carvedBed } = hydrology.grid;
  const data = new Float32Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = waterY[i];
    data[i * 4 + 1] = wetMask[i];
    data[i * 4 + 2] = carvedBed[i];
    data[i * 4 + 3] = waterY[i];
  }
  return { res, worldCells, data };
}
