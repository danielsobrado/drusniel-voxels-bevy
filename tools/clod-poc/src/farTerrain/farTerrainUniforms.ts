import type { LongViewMaterialsConfig, MaterialQuality } from "../config/longViewMaterialsConfig.js";

export interface FarTerrainUniformData {
  materialQuality: MaterialQuality;
  materialQualityIndex: number;
  waterlineM: number;
  sandMaxHeightM: number;
  grassMaxSlope: number;
  dirtMaxSlope: number;
  rockMinSlope: number;
  snowMinHeightM: number;
  snowMinSlope: number;
  macroEnabled: number;
  macroScale1: number;
  macroScale2: number;
  macroStrength: number;
  macroSlopeStrength: number;
  macroHeightStrength: number;
  farNormalStrength: number;
  farNormalFiniteDiffM: number;
  farNormalFlattenStartM: number;
  farNormalFlattenEndM: number;
  hemiStrength: number;
  sunStrength: number;
  wrapLighting: number;
  roughness: number;
  ambientFloor: number;
  hazeEnabled: number;
  hazeStartM: number;
  hazeEndM: number;
  hazeColor: [number, number, number];
  hazeStrength: number;
  hazeHeightFalloff: number;
  shellInnerDropM: number;
  normalBlendM: number;
  materialBlendM: number;
  pageToShellBlendM: number;
  debugShowMaterialBands: number;
  debugShowSlope: number;
  debugShowMacroNoise: number;
  debugShowFarNormals: number;
  debugShowHazeFactor: number;
  freezeMaterialLod: number;
}

const QUALITY_INDEX: Record<MaterialQuality, number> = {
  full_debug: 0,
  slope_tint_debug: 1,
  single_projection_far: 2,
  horizon_proxy: 3,
  atlas_only_debug: 4,
};

export function configToUniformData(config: LongViewMaterialsConfig): FarTerrainUniformData {
  return {
    materialQuality: config.material_quality.default,
    materialQualityIndex: QUALITY_INDEX[config.material_quality.default] ?? 3,
    waterlineM: config.terrain_bands.waterline_m,
    sandMaxHeightM: config.terrain_bands.sand_max_height_m,
    grassMaxSlope: config.terrain_bands.grass_max_slope,
    dirtMaxSlope: config.terrain_bands.dirt_max_slope,
    rockMinSlope: config.terrain_bands.rock_min_slope,
    snowMinHeightM: config.terrain_bands.snow_min_height_m,
    snowMinSlope: config.terrain_bands.snow_min_slope,
    macroEnabled: config.macro_variation.enabled ? 1 : 0,
    macroScale1: config.macro_variation.world_scale_1,
    macroScale2: config.macro_variation.world_scale_2,
    macroStrength: config.macro_variation.strength,
    macroSlopeStrength: config.macro_variation.slope_strength,
    macroHeightStrength: config.macro_variation.height_strength,
    farNormalStrength: config.far_normals.strength,
    farNormalFiniteDiffM: config.far_normals.finite_difference_m,
    farNormalFlattenStartM: config.far_normals.flatten_start_m,
    farNormalFlattenEndM: config.far_normals.flatten_end_m,
    hemiStrength: config.lighting.hemisphere_strength,
    sunStrength: config.lighting.sun_strength,
    wrapLighting: config.lighting.wrap_lighting,
    roughness: config.lighting.roughness,
    ambientFloor: config.lighting.ambient_floor,
    hazeEnabled: config.haze.enabled ? 1 : 0,
    hazeStartM: config.haze.start_m,
    hazeEndM: config.haze.end_m,
    hazeColor: config.haze.color,
    hazeStrength: config.haze.strength,
    hazeHeightFalloff: config.haze.height_falloff,
    shellInnerDropM: config.seam_blend.shell_inner_drop_m,
    normalBlendM: config.seam_blend.normal_blend_m,
    materialBlendM: config.seam_blend.material_blend_m,
    pageToShellBlendM: config.seam_blend.page_to_shell_blend_m,
    debugShowMaterialBands: config.debug.show_material_bands ? 1 : 0,
    debugShowSlope: config.debug.show_slope ? 1 : 0,
    debugShowMacroNoise: config.debug.show_macro_noise ? 1 : 0,
    debugShowFarNormals: config.debug.show_far_normals ? 1 : 0,
    debugShowHazeFactor: config.debug.show_haze_factor ? 1 : 0,
    freezeMaterialLod: config.debug.freeze_material_lod ? 1 : 0,
  };
}

export function createFarTerrainUniformBlock(data: FarTerrainUniformData): {
  value: FarTerrainUniformData;
  update: (next: Partial<FarTerrainUniformData>) => void;
} {
  const value = { ...data };
  return {
    value,
    update(next: Partial<FarTerrainUniformData>) {
      Object.assign(value, next);
    },
  };
}
