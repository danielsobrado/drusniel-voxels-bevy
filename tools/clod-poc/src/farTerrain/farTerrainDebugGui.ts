import type GUI from "lil-gui";
import type { LongViewMaterialsConfig, MaterialQuality } from "../config/longViewMaterialsConfig.js";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";

export interface FarTerrainDebugGuiState {
  materialQuality: MaterialQuality;
  macroEnabled: boolean;
  macroStrength: number;
  farNormalStrength: number;
  hazeStrength: number;
  hazeStartM: number;
  hazeEndM: number;
  showMaterialBands: boolean;
  showSlope: boolean;
  showMacroNoise: boolean;
  showFarNormals: boolean;
  showHazeFactor: boolean;
  freezeMaterialLod: boolean;
}

const QUALITY_OPTIONS: Record<string, MaterialQuality> = {
  "Full Debug": "full_debug",
  "Slope Tint": "slope_tint_debug",
  "Single Projection": "single_projection_far",
  "Horizon Proxy": "horizon_proxy",
  "Atlas Debug": "atlas_only_debug",
};

export function addFarTerrainMaterialGui(
  gui: GUI,
  config: LongViewMaterialsConfig,
  onUpdate: (state: FarTerrainDebugGuiState) => void,
): FarTerrainDebugGuiState {
  const state: FarTerrainDebugGuiState = {
    materialQuality: config.material_quality.default,
    macroEnabled: config.macro_variation.enabled,
    macroStrength: config.macro_variation.strength,
    farNormalStrength: config.far_normals.strength,
    hazeStrength: config.haze.strength,
    hazeStartM: config.haze.start_m,
    hazeEndM: config.haze.end_m,
    showMaterialBands: config.debug.show_material_bands,
    showSlope: config.debug.show_slope,
    showMacroNoise: config.debug.show_macro_noise,
    showFarNormals: config.debug.show_far_normals,
    showHazeFactor: config.debug.show_haze_factor,
    freezeMaterialLod: config.debug.freeze_material_lod,
  };

  const folder = gui.addFolder("Long View / Terrain Material");
  folder.add(state, "materialQuality", QUALITY_OPTIONS).name("Material Quality").onChange(() => onUpdate(state));
  folder.add(state, "macroEnabled").name("Macro Variation").onChange(() => onUpdate(state));
  folder.add(state, "macroStrength", 0, 0.5).name("Macro Strength").onChange(() => onUpdate(state));
  folder.add(state, "farNormalStrength", 0, 1.5).name("Far Normal Strength").onChange(() => onUpdate(state));
  folder.add(state, "hazeStrength", 0, 1).name("Haze Strength").onChange(() => onUpdate(state));
  folder.add(state, "hazeStartM", 0, 4000).name("Haze Start (m)").onChange(() => onUpdate(state));
  folder.add(state, "hazeEndM", 0, 5000).name("Haze End (m)").onChange(() => onUpdate(state));
  folder.add(state, "showMaterialBands").name("Show Material Bands").onChange(() => onUpdate(state));
  folder.add(state, "showSlope").name("Show Slope").onChange(() => onUpdate(state));
  folder.add(state, "showMacroNoise").name("Show Macro Noise").onChange(() => onUpdate(state));
  folder.add(state, "showFarNormals").name("Show Far Normals").onChange(() => onUpdate(state));
  folder.add(state, "showHazeFactor").name("Show Haze Factor").onChange(() => onUpdate(state));
  folder.add(state, "freezeMaterialLod").name("Freeze Material LOD").onChange(() => onUpdate(state));
  folder.open();

  return state;
}

export function guiStateToUniformUpdate(state: FarTerrainDebugGuiState): Partial<FarTerrainUniformData> {
  return {
    materialQuality: state.materialQuality,
    macroEnabled: state.macroEnabled ? 1 : 0,
    macroStrength: state.macroStrength,
    farNormalStrength: state.farNormalStrength,
    hazeStrength: state.hazeStrength,
    hazeStartM: state.hazeStartM,
    hazeEndM: state.hazeEndM,
    debugShowMaterialBands: state.showMaterialBands ? 1 : 0,
    debugShowSlope: state.showSlope ? 1 : 0,
    debugShowMacroNoise: state.showMacroNoise ? 1 : 0,
    debugShowFarNormals: state.showFarNormals ? 1 : 0,
    debugShowHazeFactor: state.showHazeFactor ? 1 : 0,
    freezeMaterialLod: state.freezeMaterialLod ? 1 : 0,
  };
}
