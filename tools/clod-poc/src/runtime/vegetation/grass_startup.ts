import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodPageNode } from "../../types.js";
import {
  type GrassLighting,
  type GrassSettings,
  type GrassStats,
} from "../../grass.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { HydrologySystem } from "../../water/index.js";
import {
  buildGrassInstancedGeometry,
  createGrassNodeMaterial,
} from "../../gpu/grass_node_material.js";
import { GrassGpuRingCompute } from "../../gpu/grass_ring_compute.js";
import { createGrassController } from "./grass_controller.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { grassUiState } from "../../app/clod_app_state.js";
import type { AppRenderer } from "../../app/bootstrap/renderer_startup.js";
import type { VegetationGpuBackend } from "./vegetation_gpu_backend.js";
import type { VegetationStatControllerRefs } from "./vegetation_types.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";

export interface GrassStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  controls: OrbitControls;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  grassConfig: ReturnType<typeof import("../../grass.js").parseGrassConfig>;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  isWebGpu: boolean;
  rendererWebGpuDevice: GPUDevice | null;
  gpuBackend: VegetationGpuBackend | null;
  hydrologySystem: HydrologySystem | null;
  currentLighting: () => EnvironmentLighting;
  statControllers: VegetationStatControllerRefs;
}

export interface GrassStartupResult {
  grassController: ReturnType<typeof createGrassController>;
  grassSystem: ReturnType<typeof createGrassController>["system"];
  makeGrassSettings: () => GrassSettings;
  grassStats: { current: GrassStats | null };
}

export function runGrassStartup(input: GrassStartupInput): GrassStartupResult {
  const {
    scene, controls, state, lod0Nodes, worldCells, grassConfig,
    queryGrassRingGrid, queryGrassRingCell, isWebGpu, rendererWebGpuDevice,
    gpuBackend, hydrologySystem, currentLighting,
  } = input;

  const grassHydrologyData = hydrologySystem ? packHydrologyData(hydrologySystem) : null;

  const currentGrassLighting = (): GrassLighting => {
    const lighting = currentLighting();
    return {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
  };
  const grassLightingToEnvironment = (lighting: GrassLighting): EnvironmentLighting => ({
    sunDirection: lighting.light,
    sunColor: lighting.sunColor,
    skyLight: lighting.skyLight,
    groundLight: lighting.groundLight,
  });

  const grassStats = { current: null as GrassStats | null };

  const grassController = createGrassController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    grassConfig,
    queryGrassRingGrid,
    queryGrassRingCell,
    supportsRing: isWebGpu,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => grassUiState(state),
    getLighting: currentGrassLighting,
    ...(isWebGpu
      ? {
          createMaterial: (settings: GrassSettings, lighting: GrassLighting, ringInstanceBuffers) =>
            createGrassNodeMaterial({
              lighting: grassLightingToEnvironment(lighting),
              bladeWidth: settings.bladeWidth,
              windStrength: settings.windStrength,
              windSpeed: settings.windSpeed,
              gustStrength: settings.wind.gustStrength,
              mode: settings.shaderMode,
              alphaToCoverage: settings.alphaToCoverage,
              distance: settings.distance,
              ring: settings.ring,
              lod: settings.lod,
              fadeCenter: new THREE.Vector2(controls.target.x, controls.target.z),
              ringInstanceBuffers,
              hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
              worldSize: worldCells,
              hydrologyRes: grassHydrologyData?.res ?? 1,
              waterClearance: 0.5,
            }),
          buildGeometry: buildGrassInstancedGeometry,
          createGpuRingCompute: (device, edits, outputBuffers, ring) =>
            GrassGpuRingCompute.create(device, edits, outputBuffers, ring, grassHydrologyData),
        }
      : {}),
    syncStatsToState: (stats) => {
      grassStats.current = stats;
      state.grassBladeCount = stats.blades;
      state.grassVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.grassTierSummary = `${stats.nearPatches}/${stats.midPatches}/${stats.coveragePatches}/${stats.superPatches}`;
      state.grassEdgeSuppressed = stats.edgeSuppressedCandidates;
      state.grassCandidateCount = stats.generatedCandidates;
      state.grassPatchRebuildCount = stats.patchRebuildCount;
      state.grassBuildMs = Number(stats.buildMs.toFixed(2));
    },
  });
  const grassSystem = grassController.system;
  const makeGrassSettings = () => grassController.makeSettings();
  state.grassBladeCount = grassSystem.getBladeCount();
  grassStats.current = grassSystem.getStats();

  return { grassController, grassSystem, makeGrassSettings, grassStats };
}
