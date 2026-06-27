import type { ClodAppState } from "../../app/clod_app_state.js";
import GUI from "lil-gui";
import { createClodGui, type ClodGuiDeps } from "./clod_gui.js";
import { createEnvironmentGui, type EnvironmentGuiDeps } from "./environment_gui.js";
import { createWeatherGui, type WeatherGuiDeps } from "./weather_gui.js";
import { createVegetationGui, type VegetationGuiDeps, type VegetationGuiStatControllers } from "./vegetation_gui.js";
import { createShadowProxyGui } from "./shadow_proxy_gui.js";
import { createClodShadowGui, type ClodShadowGuiDeps } from "./clod_shadow_gui.js";
import { createWaterGui, type WaterGuiDeps } from "./water_gui.js";
import { createTerrainMaterialGui, type TerrainMaterialGuiDeps } from "./terrain_material_gui.js";
import { createLongViewGui, type LongViewGuiDeps } from "./long_view_gui.js";
import { createNaadfGui } from "./naadf_gui.js";
import type { GuiController } from "./gui_controller.js";

export interface ClodPocGuiDeps {
  clod: ClodGuiDeps;
  environment: EnvironmentGuiDeps;
  weather: WeatherGuiDeps;
  vegetation: VegetationGuiDeps;
  water: WaterGuiDeps;
  longView?: LongViewGuiDeps;
  naadf?: import("./naadf_gui.js").NaadfGuiDeps;
  shadowProxy?: import("./shadow_proxy_gui.js").ShadowProxyGuiDeps;
  clodShadow?: ClodShadowGuiDeps;
}

export interface ClodPocTerrainMaterialGuiDeps {
  terrainMaterial: TerrainMaterialGuiDeps;
}

export interface ClodPocGuiResult {
  gui: GUI;
  colorByLodController: GuiController | null;
  weatherStatsController: GuiController | null;
  refreshGrassStats: () => void;
  refreshStoneStats: () => void;
  onStoneScatterComplete: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
  forestLightingStatsController: GuiController | null;
  shadowProxyStatsController: GuiController | null;
  clodShadowStatsController: GuiController | null;
  naadfStatsController: GuiController | null;
  statControllers: VegetationGuiStatControllers;
  digRadiusController: GuiController;
}

export function createClodPocGui(
  state: ClodAppState,
  deps: ClodPocGuiDeps,
): Omit<ClodPocGuiResult, "digRadiusController"> {
  const gui = new GUI();
  const { colorByLodController } = createClodGui(gui, state, deps.clod);
  const clodShadowStatsController = deps.clodShadow
    ? createClodShadowGui(gui, state, deps.clodShadow).statsController
    : null;
  createEnvironmentGui(gui, state, deps.environment);
  const { weatherStatsController } = createWeatherGui(gui, state, deps.weather);
  const vegetation = createVegetationGui(gui, state, deps.vegetation);
  createWaterGui(gui, deps.water);
  const shadowProxyStatsController = deps.shadowProxy
    ? createShadowProxyGui(gui, deps.shadowProxy).statsController
    : null;
  if (deps.longView) {
    createLongViewGui(gui, deps.longView);
  }
  const naadfStatsController = deps.naadf
    ? createNaadfGui(gui, deps.naadf)
    : null;
  return {
    gui,
    colorByLodController,
    weatherStatsController,
    refreshGrassStats: vegetation.refreshGrassStats,
    refreshStoneStats: vegetation.refreshStoneStats,
    onStoneScatterComplete: vegetation.onStoneScatterComplete,
    refreshTreeStats: vegetation.refreshTreeStats,
    refreshUnderstoryStats: vegetation.refreshUnderstoryStats,
    forestLightingStatsController: vegetation.forestLightingStatsController,
    shadowProxyStatsController,
    clodShadowStatsController,
    naadfStatsController,
    statControllers: vegetation.statControllers,
  };
}

export function createClodPocTerrainMaterialGui(
  gui: GUI,
  state: ClodAppState,
  deps: ClodPocTerrainMaterialGuiDeps,
): Pick<ClodPocGuiResult, "digRadiusController"> {
  return createTerrainMaterialGui(gui, state, deps.terrainMaterial);
}
