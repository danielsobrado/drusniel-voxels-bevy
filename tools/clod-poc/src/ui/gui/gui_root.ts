import GUI from "lil-gui";
import { createClodGui, type ClodGuiDeps } from "./clod_gui.js";
import { createEnvironmentGui, type EnvironmentGuiDeps } from "./environment_gui.js";
import { createWeatherGui, type WeatherGuiDeps } from "./weather_gui.js";
import { createVegetationGui, type VegetationGuiDeps, type VegetationGuiStatControllers } from "./vegetation_gui.js";
import { createWaterGui, type WaterGuiDeps } from "./water_gui.js";
import { createTerrainMaterialGui, type TerrainMaterialGuiDeps } from "./terrain_material_gui.js";
import type { GuiController } from "./gui_controller.js";

export interface ClodPocGuiDeps {
  clod: ClodGuiDeps;
  environment: EnvironmentGuiDeps;
  weather: WeatherGuiDeps;
  vegetation: VegetationGuiDeps;
  water: WaterGuiDeps;
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
  statControllers: VegetationGuiStatControllers;
  digRadiusController: GuiController;
}

export function createClodPocGui(
  state: Record<string, unknown>,
  deps: ClodPocGuiDeps,
): Omit<ClodPocGuiResult, "digRadiusController"> {
  const gui = new GUI();
  const { colorByLodController } = createClodGui(gui, state, deps.clod);
  createEnvironmentGui(gui, state, deps.environment);
  const { weatherStatsController } = createWeatherGui(gui, state, deps.weather);
  const vegetation = createVegetationGui(gui, state, deps.vegetation);
  createWaterGui(gui, deps.water);
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
    statControllers: vegetation.statControllers,
  };
}

export function createClodPocTerrainMaterialGui(
  gui: GUI,
  state: Record<string, unknown>,
  deps: ClodPocTerrainMaterialGuiDeps,
): Pick<ClodPocGuiResult, "digRadiusController"> {
  return createTerrainMaterialGui(gui, state, deps.terrainMaterial);
}
