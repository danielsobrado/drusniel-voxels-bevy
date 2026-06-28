import * as THREE from "three";
import { BIOME_IDS, type BiomeId } from "./biome_region_field.js";

export type BiomeRgb = readonly [number, number, number];

export const BIOME_RGB: Record<BiomeId, BiomeRgb> = {
  [BIOME_IDS.meadows]: [0.30, 0.38, 0.21],
  [BIOME_IDS.forest]: [0.18, 0.31, 0.14],
  [BIOME_IDS.swamp]: [0.19, 0.28, 0.20],
  [BIOME_IDS.mountain]: [0.42, 0.40, 0.36],
  [BIOME_IDS.plains]: [0.47, 0.43, 0.25],
  [BIOME_IDS.coast]: [0.64, 0.55, 0.34],
  [BIOME_IDS.ocean]: [0.10, 0.20, 0.30],
};

const FALLBACK_BIOME_RGB: BiomeRgb = BIOME_RGB[BIOME_IDS.meadows];

export function biomeRgbForId(id: number): BiomeRgb {
  const key = Math.max(0, Math.round(id)) as BiomeId;
  return BIOME_RGB[key] ?? FALLBACK_BIOME_RGB;
}

export function biomeColorForId(id: number): THREE.Color {
  const [r, g, b] = biomeRgbForId(id);
  return new THREE.Color(r, g, b);
}

export function writeBiomeRgb(target: Float32Array, vertexIndex: number, id: number): void {
  const [r, g, b] = biomeRgbForId(id);
  const offset = vertexIndex * 3;
  target[offset] = r;
  target[offset + 1] = g;
  target[offset + 2] = b;
}
