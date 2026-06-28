import type { BiomeContent, ContentRegistry, TextureSlotContent } from "./types.js";
import { BIOME_IDS, type BiomeId } from "../world_source/biome_region_field.js";

export const EXPECTED_BIOME_REGION_IDS: readonly BiomeId[] = [
  BIOME_IDS.meadows,
  BIOME_IDS.forest,
  BIOME_IDS.swamp,
  BIOME_IDS.mountain,
  BIOME_IDS.plains,
  BIOME_IDS.coast,
  BIOME_IDS.ocean,
] as const;

export interface BiomeTextureSlotSet {
  biome: BiomeContent;
  slots: TextureSlotContent[];
  slotIndices: number[];
}

export function getBiomeContentByBiomeId(
  registry: ContentRegistry,
  biomeId: number,
): BiomeContent | undefined {
  const id = Math.max(0, Math.round(biomeId));
  for (const biome of registry.biomes.values()) {
    if (biome.biomeId === id) return biome;
  }
  return undefined;
}

export function requireBiomeContentByBiomeId(
  registry: ContentRegistry,
  biomeId: number,
): BiomeContent {
  const biome = getBiomeContentByBiomeId(registry, biomeId);
  if (!biome) throw new Error(`No biome content registered for biomeId ${biomeId}`);
  return biome;
}

export function getBiomeTextureSlotSet(
  registry: ContentRegistry,
  biomeId: number,
): BiomeTextureSlotSet | undefined {
  const biome = getBiomeContentByBiomeId(registry, biomeId);
  if (!biome) return undefined;
  const slotIds = biome.region?.terrainTextureSlots ?? biome.textureSlotSet;
  const slots: TextureSlotContent[] = [];
  const slotIndices: number[] = [];
  for (const slotId of slotIds) {
    const slot = registry.textureSlots.get(slotId);
    if (!slot) continue;
    slots.push(slot);
    slotIndices.push(slot.slotIndex);
  }
  return { biome, slots, slotIndices };
}

export function getBiomeDebugColorRgb(
  registry: ContentRegistry,
  biomeId: number,
): [number, number, number] {
  const biome = getBiomeContentByBiomeId(registry, biomeId);
  return biome?.region?.debugColorRgb ?? [77, 97, 54];
}

export function getBiomeCanopyDensity(
  registry: ContentRegistry,
  biomeId: number,
): number {
  const biome = getBiomeContentByBiomeId(registry, biomeId);
  return biome?.region?.canopyDensity ?? 0;
}

export function buildBiomeTextureLayerMap(registry: ContentRegistry): Map<BiomeId, number[]> {
  const map = new Map<BiomeId, number[]>();
  for (const id of EXPECTED_BIOME_REGION_IDS) {
    map.set(id, getBiomeTextureSlotSet(registry, id)?.slotIndices ?? []);
  }
  return map;
}
