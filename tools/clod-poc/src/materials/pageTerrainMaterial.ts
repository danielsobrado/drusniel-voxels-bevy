import {
  sampleDrusnielTerrainMaterial,
  type DrusnielTerrainMaterialInput,
  type DrusnielTerrainMaterialSample,
} from "./terrainMaterialCommon.js";

export interface PageTerrainMaterialInput extends DrusnielTerrainMaterialInput {
  pageId: string;
}

export function samplePageTerrainMaterial(input: PageTerrainMaterialInput): DrusnielTerrainMaterialSample {
  return sampleDrusnielTerrainMaterial(input);
}
