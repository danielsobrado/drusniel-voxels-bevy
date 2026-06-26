import type * as THREE from "three";
import type { GrassController } from "../../runtime/vegetation/grass_controller.js";
import type { TreeController } from "../../runtime/vegetation/tree_controller.js";
import type { UnderstoryController } from "../../runtime/vegetation/understory_controller.js";
import type { ForestLightingController } from "../../runtime/forest_lighting/forest_lighting_controller.js";
import type { StoneController } from "../../runtime/vegetation/stone_controller.js";
import type { PropController } from "../../systems/prop_controller.js";
import type { DeepOceanSurface } from "../../water/deep_ocean_surface.js";
import type { DeepOceanMaterialHandle } from "../../water/deep_ocean_material.js";
import type { WaterController } from "../../runtime/water_weather/water_controller.js";
import type { WeatherController } from "../../runtime/water_weather/weather_controller.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

interface GuiDisplayController {
  updateDisplay: () => unknown;
}

export interface VegetationFramePhaseInput {
  elapsedSeconds: number;
  playerDelta: number;
  ringCenter: THREE.Vector3;
  grassCenter: THREE.Vector3;
  camera: THREE.Camera;
  state: ClodFrameLoopUiState;
  grassController: GrassController;
  treeController: TreeController;
  understoryController: UnderstoryController;
  forestLightingController: ForestLightingController;
  applyForestLightingToPropMaterials: () => void;
  stoneController: StoneController;
  propController: PropController | null;
  waterController: WaterController;
  deepOceanSurface: DeepOceanSurface | null;
  deepOceanMaterial: DeepOceanMaterialHandle | null;
  weatherController: WeatherController;
  updateWeatherStats: () => void;
  weatherStatsController: GuiDisplayController | null;
  currentLighting: () => { sunDirection: THREE.Vector3; skyLight: THREE.Color };
  selectionFrameId: number;
  worldCells: number;
}

export function runVegetationFramePhase(input: VegetationFramePhaseInput): void {
  input.grassController.update(input.elapsedSeconds, input.ringCenter, input.camera);
  input.treeController.update(input.elapsedSeconds, input.ringCenter, input.camera);
  input.understoryController.update(input.elapsedSeconds, input.ringCenter, input.camera);
  input.forestLightingController.update(input.elapsedSeconds, input.grassCenter, {
    treeProxies: input.treeController.system.getLightingProxies(),
    understoryProxies: input.understoryController.system.getLightingProxies(),
    sunDirection: input.currentLighting().sunDirection,
  });
  input.applyForestLightingToPropMaterials();
  input.stoneController.update(input.ringCenter);
  input.propController?.update(input.camera as THREE.PerspectiveCamera);
  input.waterController.update(Math.min(input.playerDelta, 0.1), input.camera.position);
  input.deepOceanSurface?.update(input.elapsedSeconds);
  if (input.deepOceanMaterial) {
    input.deepOceanMaterial.setTime(input.elapsedSeconds);
    input.deepOceanMaterial.updateCamera(input.camera.position);
    const lighting = input.currentLighting();
    input.deepOceanMaterial.updateSunDirection(lighting.sunDirection);
    input.deepOceanMaterial.updateHorizonColor(lighting.skyLight);
  }
  input.weatherController.update(input.playerDelta, input.elapsedSeconds, input.camera.position, input.grassCenter);
  if (input.state.weatherMode !== "off" && input.selectionFrameId % 30 === 0) {
    input.updateWeatherStats();
    input.weatherStatsController?.updateDisplay();
  }
  input.waterController.logDevInitOnce(input.worldCells);
}
