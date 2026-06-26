export const PROCEDURAL_DEBUG_MODES = {
  final: 0,
  "macro noise": 1,
  "paint weights": 2,
  "albedo layer": 3,
  "normal strength": 4,
  roughness: 5,
  "page LOD": 6,
  "seam stress": 7,
  "river wetness": 8,
  "river foam residue": 9,
  "river droplets": 10,
} as const;

export type ProceduralDebugMode = keyof typeof PROCEDURAL_DEBUG_MODES;

export const TEXTURE_BLEND_MODES = ["hard bands", "blend bands"] as const;
export const TERRAIN_MATERIAL_SOURCES = ["procedural", "external_pbr", "debug_flat"] as const;
export type TerrainMaterialSource = typeof TERRAIN_MATERIAL_SOURCES[number];

export const terrainMaterialSourceParam = (value: string | null): TerrainMaterialSource | null =>
  TERRAIN_MATERIAL_SOURCES.includes(value as TerrainMaterialSource) ? value as TerrainMaterialSource : null;
