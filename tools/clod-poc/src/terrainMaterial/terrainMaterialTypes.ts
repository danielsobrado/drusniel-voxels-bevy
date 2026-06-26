export type MaterialId = "sand" | "grass" | "dirt" | "rock" | "snow";

export const MATERIAL_IDS: readonly MaterialId[] = ["sand", "grass", "dirt", "rock", "snow"];

export interface MaterialWeights {
  sand: number;
  grass: number;
  dirt: number;
  rock: number;
  snow: number;
}

export interface TerrainMaterialSample {
  materialId: MaterialId;
  weights: MaterialWeights;
  baseColor: [number, number, number];
  roughness: number;
  macroVariation: number;
  debugMaterialId: number;
  debugWeights: [number, number, number, number, number];
  valid: boolean;
}

export interface TerrainMaterialInput {
  worldX: number;
  worldZ: number;
  height: number;
  slope: number;
  waterLevel: number;
  config: {
    waterline_m: number;
    sand_max_height_m: number;
    grass_max_slope: number;
    dirt_max_slope: number;
    rock_min_slope: number;
    snow_min_height_m: number;
    snow_min_slope: number;
    macro_variation: {
      enabled: boolean;
      world_scale_1: number;
      world_scale_2: number;
      strength: number;
      slope_strength: number;
      height_strength: number;
    };
  };
}
