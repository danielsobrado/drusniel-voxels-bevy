import type * as THREE from "three";
import type { GrassController } from "../../systems/grass_controller.js";
import type { TreeController } from "../../systems/tree_controller.js";
import type { UnderstoryController } from "../../systems/understory_controller.js";
import type { ForestLightingController } from "../../systems/forest_lighting_controller.js";
import type { StoneController } from "../../systems/stone_controller.js";
import type { WaterController } from "../../systems/water_controller.js";
import type { WeatherController } from "../../systems/weather_controller.js";
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
  waterController: WaterController;
  weatherController: WeatherController;
  updateWeatherStats: () => void;
  weatherStatsController: GuiDisplayController | null;
  currentLighting: () => { sunDirection: THREE.Vector3 };
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
  input.waterController.update(Math.min(input.playerDelta, 0.1), input.camera.position);
  input.weatherController.update(input.playerDelta, input.elapsedSeconds, input.camera.position, input.grassCenter);
  if (input.state.weatherMode !== "off" && input.selectionFrameId % 30 === 0) {
    input.updateWeatherStats();
    input.weatherStatsController?.updateDisplay();
  }
  input.waterController.logDevInitOnce(input.worldCells);
}
