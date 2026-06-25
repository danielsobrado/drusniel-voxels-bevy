import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodPageNode } from "../../types.js";
import {
  type GrassLighting,
  type GrassSettings,
  type GrassStats,
  parseGrassConfig,
} from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { type StoneStats } from "../../stones/stone_instances.js";
import { formatTreeTotalDisplay, parseTreeConfig, type TreeStats } from "../../trees/index.js";
import {
  type UnderstoryStats,
  parseUnderstoryConfig,
} from "../../understory/index.js";
import type { HydrologySystem } from "../../water/index.js";
import type { EnvironmentLighting } from "../../environment.js";
import {
  buildGrassInstancedGeometry,
  createGrassNodeMaterial,
} from "../../gpu/grass_node_material.js";
import { createGrassController } from "../../systems/grass_controller.js";
import { createStoneController } from "../../systems/stone_controller.js";
import { createTreeController } from "../../systems/tree_controller.js";
import { createUnderstoryController } from "../../systems/understory_controller.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";
import type { ClodAppState } from "../clod_app_state.js";
import {
  grassUiState,
  stoneUiState,
  treeUiState,
  understoryUiState,
} from "../clod_app_state.js";
import type { AppRenderer } from "./renderer_startup.js";

export interface GuiDisplayController {
  updateDisplay: () => unknown;
}

export interface VegetationStatControllerRefs {
  stoneTotal: GuiDisplayController | null;
  stoneClassSummary: GuiDisplayController | null;
  stoneVisible: GuiDisplayController | null;
  treeTotal: GuiDisplayController | null;
  treeVisiblePatches: GuiDisplayController | null;
  treeLodSummary: GuiDisplayController | null;
  treeGpuSummary: GuiDisplayController | null;
  understoryTotal: GuiDisplayController | null;
  understoryVisiblePatches: GuiDisplayController | null;
  understoryClassSummary: GuiDisplayController | null;
  understoryGpuSummary: GuiDisplayController | null;
}

export interface VegetationStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  controls: OrbitControls;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  grassConfig: ReturnType<typeof parseGrassConfig>;
  stoneConfig: ReturnType<typeof parseStoneConfig>;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  isWebGpu: boolean;
  rendererWebGpuDevice: GPUDevice | null;
  hydrologySystem: HydrologySystem | null;
  currentLighting: () => EnvironmentLighting;
  statControllers: VegetationStatControllerRefs;
}

export interface VegetationStartupResult {
  grassController: ReturnType<typeof createGrassController>;
  grassSystem: ReturnType<typeof createGrassController>["system"];
  makeGrassSettings: () => GrassSettings;
  grassStats: { current: GrassStats | null };
  stoneController: ReturnType<typeof createStoneController>;
  stoneSystem: ReturnType<typeof createStoneController>["system"];
  stoneStats: { current: StoneStats | null };
  visibleStoneClasses: ReturnType<typeof createStoneController>["visibleClasses"];
  treeController: ReturnType<typeof createTreeController>;
  treeSystem: ReturnType<typeof createTreeController>["system"];
  fallingTrees: ReturnType<typeof createTreeController>["fallingTrees"];
  treeStats: { current: TreeStats | null };
  understoryController: ReturnType<typeof createUnderstoryController>;
  understorySystem: ReturnType<typeof createUnderstoryController>["system"];
  understoryStats: { current: UnderstoryStats | null };
  formatTreeGpuSummary: (stats: TreeStats) => string;
  formatUnderstoryGpuSummary: (stats: UnderstoryStats) => string;
  onStoneScatterComplete: { current: (() => void) | null };
}

export function runVegetationStartup(input: VegetationStartupInput): VegetationStartupResult {
  const {
    app,
    scene,
    controls,
    state,
    lod0Nodes,
    worldCells,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    queryGrassRingGrid,
    queryGrassRingCell,
    isWebGpu,
    rendererWebGpuDevice,
    hydrologySystem,
    currentLighting,
    statControllers,
  } = input;

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
  const gpuBackend = isWebGpu ? (app.renderer as import("three/webgpu").WebGPURenderer).backend as unknown as {
    createStorageAttribute(attribute: THREE.BufferAttribute): void;
    createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
    get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
  } : null;

  const formatTreeGpuSummary = (stats: TreeStats): string =>
    stats.gpuStatus === "disabled"
      ? "disabled"
      : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}`;
  const formatUnderstoryGpuSummary = (stats: UnderstoryStats): string =>
    stats.gpuStatus === "disabled"
      ? "disabled"
      : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}${stats.gpuDispatchMs !== null ? ` ${stats.gpuDispatchMs.toFixed(1)}ms` : ""}`;

  const onStoneScatterComplete = { current: null as (() => void) | null };

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
              waterClearance: 0.5,
            }),
          buildGeometry: buildGrassInstancedGeometry,
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

  const stoneStats = { current: null as StoneStats | null };
  const stoneController = createStoneController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    stoneConfig,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => stoneUiState(state),
    getLighting: currentGrassLighting,
    onScatterStats: () => onStoneScatterComplete.current?.(),
    syncStatsToState: (stats) => {
      stoneStats.current = stats;
      state.stoneTotal = stats.total;
      state.stoneClassSummary = `${stats.large}/${stats.medium}/${stats.small}`;
      state.stoneVisible = stats.visible;
      statControllers.stoneTotal?.updateDisplay();
      statControllers.stoneClassSummary?.updateDisplay();
      statControllers.stoneVisible?.updateDisplay();
    },
  });
  const stoneSystem = stoneController.system;
  const visibleStoneClasses = () => stoneController.visibleClasses();
  stoneStats.current = stoneSystem.getStats();

  const treeStats = { current: null as TreeStats | null };
  const treeController = createTreeController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    treeConfig,
    webgpu: isWebGpu,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => treeUiState(state),
    getLighting: currentLighting,
    syncStatsToState: (stats) => {
      treeStats.current = stats;
      state.treeTotal = formatTreeTotalDisplay(stats);
      state.treeVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.treeLodSummary = `${stats.nearTrees}/${stats.midTrees}/${stats.farTrees}/${stats.impostorTrees}`;
      state.treeGpuSummary = formatTreeGpuSummary(stats);
      statControllers.treeTotal?.updateDisplay();
      statControllers.treeVisiblePatches?.updateDisplay();
      statControllers.treeLodSummary?.updateDisplay();
      statControllers.treeGpuSummary?.updateDisplay();
    },
  });
  const treeSystem = treeController.system;
  const fallingTrees = treeController.fallingTrees;
  treeStats.current = treeSystem.getStats();

  const understoryStats = { current: null as UnderstoryStats | null };
  const understoryController = createUnderstoryController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    understoryConfig,
    webgpu: isWebGpu,
    hydrologyData: hydrologySystem ? packHydrologyData(hydrologySystem) : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => understoryUiState(state),
    getLighting: currentLighting,
    syncStatsToState: (stats) => {
      understoryStats.current = stats;
      state.understoryTotal = stats.totalInstances;
      state.understoryVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.understoryClassSummary =
        `${stats.shrub}/${stats.fern}/${stats.sapling}/${stats.flower}/${stats.deadLog}/${stats.stump}`;
      state.understoryGpuSummary = formatUnderstoryGpuSummary(stats);
      statControllers.understoryTotal?.updateDisplay();
      statControllers.understoryVisiblePatches?.updateDisplay();
      statControllers.understoryClassSummary?.updateDisplay();
      statControllers.understoryGpuSummary?.updateDisplay();
    },
  });
  const understorySystem = understoryController.system;
  understoryStats.current = understorySystem.getStats();

  return {
    grassController,
    grassSystem,
    makeGrassSettings,
    grassStats,
    stoneController,
    stoneSystem,
    stoneStats,
    visibleStoneClasses,
    treeController,
    treeSystem,
    fallingTrees,
    treeStats,
    understoryController,
    understorySystem,
    understoryStats,
    formatTreeGpuSummary,
    formatUnderstoryGpuSummary,
    onStoneScatterComplete,
  };
}
