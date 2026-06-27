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

export interface VegetationFrameTiming {
  grassMs: number;
  treesMs: number;
  understoryMs: number;
  forestLightingMs: number;
  stonesMs: number;
  customPropsMs: number;
  waterMs: number;
  deepOceanMs: number;
  weatherMs: number;
  totalMs: number;
}

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

export function runVegetationFramePhase(input: VegetationFramePhaseInput): VegetationFrameTiming {
  const phaseStart = performance.now();
  const grassMs = measure(() => input.grassController.update(input.elapsedSeconds, input.ringCenter, input.camera));
  const treesMs = measure(() => input.treeController.update(input.elapsedSeconds, input.ringCenter, input.camera));
  const understoryMs = measure(() => input.understoryController.update(input.elapsedSeconds, input.ringCenter, input.camera));
  const forestLightingMs = measure(() => {
    input.forestLightingController.update(input.elapsedSeconds, input.grassCenter, {
      treeProxies: input.treeController.system.getLightingProxies(),
      understoryProxies: input.understoryController.system.getLightingProxies(),
      sunDirection: input.currentLighting().sunDirection,
    });
    input.applyForestLightingToPropMaterials();
  });
  const stonesMs = measure(() => input.stoneController.update(input.ringCenter));
  const customPropsMs = measure(() => input.propController?.update(input.camera as THREE.PerspectiveCamera));
  const waterMs = measure(() => {
    input.waterController.update(Math.min(input.playerDelta, 0.1), input.camera.position);
    input.waterController.logDevInitOnce(input.worldCells);
  });
  const deepOceanMs = measure(() => {
    input.deepOceanSurface?.update(input.elapsedSeconds);
    if (input.deepOceanMaterial) {
      input.deepOceanMaterial.setTime(input.elapsedSeconds);
      input.deepOceanMaterial.updateCamera(input.camera.position);
      const lighting = input.currentLighting();
      input.deepOceanMaterial.updateSunDirection(lighting.sunDirection);
      input.deepOceanMaterial.updateHorizonColor(lighting.skyLight);
    }
  });
  const weatherMs = measure(() => {
    input.weatherController.update(input.playerDelta, input.elapsedSeconds, input.camera.position, input.grassCenter);
    if (input.state.weatherMode !== "off" && input.selectionFrameId % 30 === 0) {
      input.updateWeatherStats();
      input.weatherStatsController?.updateDisplay();
    }
  });

  return {
    grassMs,
    treesMs,
    understoryMs,
    forestLightingMs,
    stonesMs,
    customPropsMs,
    waterMs,
    deepOceanMs,
    weatherMs,
    totalMs: performance.now() - phaseStart,
  };
}
