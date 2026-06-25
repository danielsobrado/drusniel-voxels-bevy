import type { ProjectSessionState } from "../../project_archive.js";
import {
  TEXTURE_BLEND_MODES,
  type ProceduralDebugMode,
  type TerrainMaterialSource,
} from "../../terrain/material/terrain_material_constants.js";
import type { TextureBlendMode } from "../../project_archive.js";
import { DEFAULT_TERRAIN_COLOR_ADJUSTMENTS } from "../../material.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface TerrainMaterialSliceState {
  terrainMaterialSource: TerrainMaterialSource;
  proceduralDebugMode: ProceduralDebugMode;
  proceduralMicroNormals: boolean;
  textureScale: number;
  triplanar: boolean;
  albedo: boolean;
  normalMap: boolean;
  normalIntensity: number;
  roughness: number;
  metalness: number;
  textureBlendMode: TextureBlendMode;
  textureBlendWidth: number;
  loadedTextureFiles: string;
  terrainBrightness: number;
  terrainContrast: number;
  terrainSaturation: number;
  terrainWarmth: number;
}

const TERRAIN_MATERIAL_ARCHIVE_KEYS = [
  "textureScale", "triplanar", "albedo", "normalMap", "normalIntensity", "roughness", "metalness",
  "textureBlendMode", "textureBlendWidth", "terrainBrightness", "terrainContrast", "terrainSaturation",
  "terrainWarmth",
] as const satisfies readonly (keyof ProjectSessionState)[];

export function createTerrainMaterialSliceState(input: {
  queryPerfMode: boolean;
  queryTerrainMaterialSource: TerrainMaterialSource | null;
  terrainTriplanar: boolean;
}): TerrainMaterialSliceState {
  return {
    terrainMaterialSource: input.queryTerrainMaterialSource ?? "external_pbr",
    proceduralDebugMode: "final",
    proceduralMicroNormals: true,
    textureScale: 1,
    triplanar: input.terrainTriplanar,
    albedo: !input.queryPerfMode,
    normalMap: false,
    normalIntensity: 1,
    roughness: 0.9,
    metalness: 0,
    textureBlendMode: TEXTURE_BLEND_MODES[1] as TextureBlendMode,
    textureBlendWidth: 6,
    loadedTextureFiles: "none",
    terrainBrightness: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness,
    terrainContrast: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast,
    terrainSaturation: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation,
    terrainWarmth: DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth,
  };
}

export function applyTerrainMaterialArchiveState(
  target: TerrainMaterialSliceState,
  archive: ProjectSessionState,
): void {
  assignArchiveFields(target, archive, TERRAIN_MATERIAL_ARCHIVE_KEYS);
}
