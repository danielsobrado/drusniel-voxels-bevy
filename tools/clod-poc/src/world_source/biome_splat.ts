import { biomeTextureMaterialForBiomeId } from "../textures/biome_texture_streaming_manager.js";
import type { BiomeProceduralMaterialId } from "../textures/materialRecipes.js";
import { type BiomeId } from "./biome_region_field.js";

export interface BiomeSplatWeight {
  material: BiomeProceduralMaterialId;
  weight: number;
}

export interface BiomeSplatSample {
  dominantLayer: BiomeProceduralMaterialId;
  weights: BiomeSplatWeight[];
}

export function sampleBiomeSplat(biomeId: BiomeId): BiomeSplatSample {
  const dominantLayer = biomeTextureMaterialForBiomeId(biomeId);
  return {
    dominantLayer,
    weights: [{ material: dominantLayer, weight: 1 }],
  };
}
