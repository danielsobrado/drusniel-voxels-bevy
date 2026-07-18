import type { GrassHydrologyData } from "../gpu/grass_ring_compute.js";

let fieldsData: GrassHydrologyData | null = null;

export function setStoneHydrologyFieldsData(data: GrassHydrologyData | null): void {
  fieldsData = data;
}

export function readStoneHydrologyFieldsData(): GrassHydrologyData | null {
  return fieldsData;
}
