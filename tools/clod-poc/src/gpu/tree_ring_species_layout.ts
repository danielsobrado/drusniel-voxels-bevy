export const TREE_RING_LOD_COUNT = 4;
export const TREE_RING_INDIRECT_STRIDE_U32 = 5;

export interface TreeRingSpeciesLayout {
  speciesCount: number;
  lodCount: number;
  groupCount: number;
  shadowCascadeCount: number;
  shadowGroupCount: number;
  speciesWeightsOffset: number;
  speciesWeightsFloatCount: number;
  terrainVisibilityOffset: number;
  terrainVisibilityUOffset: number;
  indexCountsOffset: number;
  settingsOffset: number;
  materialDensityOffset: number;
  speciesMaterialOffset: number;
  visiblePlanesOffset: number;
  shadowPlanesOffset: number;
  hydroAtlasOffset: number;
  paramFloatCount: number;
  paramBytes: number;
}

const VISIBLE_PLANE_FLOATS = 6 * 4;
const SHADOW_PLANE_FLOATS_PER_CASCADE = 6 * 4;
const BASE_HEADER_FLOATS = 28;
const TERRAIN_VISIBILITY_FLOATS = 4;
const TERRAIN_VISIBILITY_U32S = 4;
const SETTINGS_FLOATS = 4;
const MATERIAL_DENSITY_FLOATS = 4;
const HYDRO_ATLAS_FLOATS = 4;

export function treeRingSpeciesLayout(speciesCount: number, shadowCascadeCount: number): TreeRingSpeciesLayout {
  const safeSpeciesCount = Math.max(1, Math.floor(speciesCount));
  const safeCascadeCount = Math.max(1, Math.floor(shadowCascadeCount));
  const groupCount = safeSpeciesCount * TREE_RING_LOD_COUNT;
  const speciesWeightsOffset = BASE_HEADER_FLOATS;
  const speciesWeightsFloatCount = align4(safeSpeciesCount);
  const terrainVisibilityOffset = speciesWeightsOffset + speciesWeightsFloatCount;
  const terrainVisibilityUOffset = terrainVisibilityOffset + TERRAIN_VISIBILITY_FLOATS;
  const indexCountsOffset = terrainVisibilityUOffset + TERRAIN_VISIBILITY_U32S;
  const settingsOffset = indexCountsOffset + align4(groupCount);
  const materialDensityOffset = settingsOffset + SETTINGS_FLOATS;
  const speciesMaterialOffset = materialDensityOffset + MATERIAL_DENSITY_FLOATS;
  const visiblePlanesOffset = speciesMaterialOffset + safeSpeciesCount * 4;
  const shadowPlanesOffset = visiblePlanesOffset + VISIBLE_PLANE_FLOATS;
  const hydroAtlasOffset = shadowPlanesOffset + safeCascadeCount * SHADOW_PLANE_FLOATS_PER_CASCADE;
  const paramFloatCount = hydroAtlasOffset + HYDRO_ATLAS_FLOATS;
  return {
    speciesCount: safeSpeciesCount,
    lodCount: TREE_RING_LOD_COUNT,
    groupCount,
    shadowCascadeCount: safeCascadeCount,
    shadowGroupCount: groupCount * safeCascadeCount,
    speciesWeightsOffset,
    speciesWeightsFloatCount,
    terrainVisibilityOffset,
    terrainVisibilityUOffset,
    indexCountsOffset,
    settingsOffset,
    materialDensityOffset,
    speciesMaterialOffset,
    visiblePlanesOffset,
    shadowPlanesOffset,
    hydroAtlasOffset,
    paramFloatCount,
    paramBytes: align4(paramFloatCount) * Float32Array.BYTES_PER_ELEMENT,
  };
}

export function treeRingSpeciesGroupIndex(speciesIndex: number, lodIndex: number, speciesCount: number): number {
  const safeSpeciesIndex = Math.max(0, Math.floor(speciesIndex));
  const safeLodIndex = Math.max(0, Math.floor(lodIndex));
  return Math.min(Math.max(1, Math.floor(speciesCount)) - 1, safeSpeciesIndex) * TREE_RING_LOD_COUNT + Math.min(TREE_RING_LOD_COUNT - 1, safeLodIndex);
}

function align4(value: number): number {
  return Math.ceil(Math.max(0, value) / 4) * 4;
}
