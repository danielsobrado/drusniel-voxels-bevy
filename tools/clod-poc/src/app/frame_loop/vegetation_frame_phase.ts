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
import type { WaterFieldResult } from "../../water/index.js";
import type { WeatherController } from "../../runtime/water_weather/weather_controller.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";
import { computeWorldCenterDebugStats, publishWorldCenterStatsToCounters } from "../../stream/world_center_debug.js";

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
  collectTiming: boolean;
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

const EMPTY_TIMING: VegetationFrameTiming = {
  grassMs: 0,
  treesMs: 0,
  understoryMs: 0,
  forestLightingMs: 0,
  stonesMs: 0,
  customPropsMs: 0,
  waterMs: 0,
  deepOceanMs: 0,
  weatherMs: 0,
  totalMs: 0,
};

const HYDROLOGY_DIAGNOSTIC_OFFSET_M = 173;
const HYDROLOGY_NONREPEAT_EPSILON_M = 0.001;

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function finiteWaterSample(sample: WaterFieldResult): boolean {
  return Number.isFinite(sample.waterY)
    && Number.isFinite(sample.terrainY)
    && Number.isFinite(sample.depth)
    && Number.isFinite(sample.bodyMask)
    && Number.isFinite(sample.flow.x)
    && Number.isFinite(sample.flow.z)
    && Number.isFinite(sample.flow.speed)
    && Number.isFinite(sample.flow.progress)
    && Number.isFinite(sample.flow.drop);
}

function mirrorInfiniteHydrologyDiagnostics(input: VegetationFramePhaseInput): void {
  const hooks = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod;
  const counters = hooks?.stats?.counters;
  if (!counters || input.worldCells <= 0) return;

  publishWorldCenterStatsToCounters(counters, computeWorldCenterDebugStats({
    camera: input.camera.position,
    waterOceanCenter: input.camera.position,
  }));

  const outsideX = input.worldCells + HYDROLOGY_DIAGNOSTIC_OFFSET_M;
  const outsideZ = -HYDROLOGY_DIAGNOSTIC_OFFSET_M;
  const wrappedX = HYDROLOGY_DIAGNOSTIC_OFFSET_M;
  const wrappedZ = input.worldCells - HYDROLOGY_DIAGNOSTIC_OFFSET_M;
  const outside = input.waterController.field.sample(outsideX, outsideZ);
  const wrapped = input.waterController.field.sample(wrappedX, wrappedZ);
  const cameraOutside = input.camera.position.x < 0
    || input.camera.position.z < 0
    || input.camera.position.x > input.worldCells
    || input.camera.position.z > input.worldCells;
  const nonrepeatDelta = Math.abs(outside.terrainY - wrapped.terrainY)
    + Math.abs(outside.waterY - wrapped.waterY)
    + Math.abs(outside.bodyMask - wrapped.bodyMask);

  counters["infinite_hydrology_outside_sample_valid"] = finiteWaterSample(outside) ? 1 : 0;
  counters["infinite_hydrology_outside_body_mask"] = outside.bodyMask;
  counters["infinite_hydrology_outside_depth_m"] = outside.depth;
  counters["infinite_hydrology_nonrepeat_delta"] = nonrepeatDelta;
  counters["infinite_hydrology_nonrepeat_ok"] = nonrepeatDelta > HYDROLOGY_NONREPEAT_EPSILON_M ? 1 : 0;
  counters["infinite_hydrology_camera_outside_startup"] = cameraOutside ? 1 : 0;
}

function updateForestLighting(input: VegetationFramePhaseInput): void {
  const lighting = input.currentLighting();
  const completed = input.forestLightingController.updateBudgeted(input.grassCenter, lighting.sunDirection);
  if (completed) input.applyForestLightingToPropMaterials();
}

function updateWater(input: VegetationFramePhaseInput): void {
  mirrorInfiniteHydrologyDiagnostics(input);
  if (!input.state.waterEnabled) return;
  input.waterController.update(Math.min(input.playerDelta, 0.1), input.camera.position);
  input.waterController.logDevInitOnce(input.worldCells);
}

function updateDeepOcean(input: VegetationFramePhaseInput): void {
  input.deepOceanSurface?.update(input.elapsedSeconds);
  if (!input.deepOceanMaterial) return;
  input.deepOceanMaterial.setTime(input.elapsedSeconds);
  input.deepOceanMaterial.updateCamera(input.camera.position);
  const lighting = input.currentLighting();
  input.deepOceanMaterial.updateSunDirection(lighting.sunDirection);
  input.deepOceanMaterial.updateHorizonColor(lighting.skyLight);
}

function updateWeather(input: VegetationFramePhaseInput): void {
  input.weatherController.update(input.playerDelta, input.elapsedSeconds, input.camera.position, input.grassCenter);
  if (input.state.weatherMode !== "off" && input.selectionFrameId % 30 === 0) {
    input.updateWeatherStats();
    input.weatherStatsController?.updateDisplay();
  }
}

function updateUntimed(input: VegetationFramePhaseInput): VegetationFrameTiming {
  input.grassController.update(input.elapsedSeconds, input.ringCenter, input.camera);
  input.treeController.update(input.elapsedSeconds, input.ringCenter, input.camera);
  input.understoryController.update(input.elapsedSeconds, input.ringCenter, input.camera);
  updateForestLighting(input);
  input.stoneController.update(input.ringCenter);
  input.propController?.update(input.camera as THREE.PerspectiveCamera, input.ringCenter);
  updateWater(input);
  updateDeepOcean(input);
  updateWeather(input);
  return EMPTY_TIMING;
}

export function runVegetationFramePhase(input: VegetationFramePhaseInput): VegetationFrameTiming {
  if (!input.collectTiming) return updateUntimed(input);

  const phaseStart = performance.now();
  const grassMs = measure(() => input.grassController.update(input.elapsedSeconds, input.ringCenter, input.camera));
  const treesMs = measure(() => input.treeController.update(input.elapsedSeconds, input.ringCenter, input.camera));
  const understoryMs = measure(() => input.understoryController.update(input.elapsedSeconds, input.ringCenter, input.camera));
  const forestLightingMs = measure(() => updateForestLighting(input));
  const stonesMs = measure(() => input.stoneController.update(input.ringCenter));
  const customPropsMs = measure(() => input.propController?.update(input.camera as THREE.PerspectiveCamera, input.ringCenter));
  const waterMs = measure(() => updateWater(input));
  const deepOceanMs = measure(() => updateDeepOcean(input));
  const weatherMs = measure(() => updateWeather(input));

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
