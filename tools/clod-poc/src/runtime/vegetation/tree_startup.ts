import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import { formatTreeTotalDisplay, type TreeStats } from "../../trees/index.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { HydrologySystem } from "../../water/index.js";
import { createTreeController } from "./tree_controller.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { treeUiState } from "../../app/clod_app_state.js";
import type { VegetationGpuBackend } from "./vegetation_gpu_backend.js";
import type { VegetationStatControllerRefs } from "./vegetation_types.js";
import { formatTreeGpuSummary } from "./vegetation_stats_presenter.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";
import { setTreeGpuRingHydrologyData } from "../../gpu/tree_ring_compute.js";
import type { TreeSettings } from "../../trees/tree_config.js";
import type { TreeTerrainOcclusionSampler } from "../../trees/tree_terrain_occlusion.js";
import { createEmptyTreeSystemStats } from "../../trees/tree_system_stats.js";
import { estimateTreeImpostorAtlasMemoryMiB } from "../../trees/tree_impostor_memory.js";
import { mountTreeImpostorLabFromWindow } from "../../trees/tree_impostor_lab.js";
import { stabilizeRuntimeTreeSettings } from "../../trees/tree_runtime_stability.js";

export interface TreeStartupInput {
  scene: THREE.Scene;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  treeConfig: ReturnType<typeof import("../../trees/index.js").parseTreeConfig>;
  isWebGpu: boolean;
  hydrologySystem: HydrologySystem | null;
  terrainOcclusionSampler?: TreeTerrainOcclusionSampler;
  rendererWebGpuDevice: GPUDevice | null;
  gpuBackend: VegetationGpuBackend | null;
  currentLighting: () => EnvironmentLighting;
  statControllers: VegetationStatControllerRefs;
  renderer: unknown;
}

export interface TreeStartupResult {
  treeController: ReturnType<typeof createTreeController>;
  treeSystem: ReturnType<typeof createTreeController>["system"];
  fallingTrees: ReturnType<typeof createTreeController>["fallingTrees"];
  treeStats: { current: TreeStats | null };
  formatTreeGpuSummary: (stats: TreeStats) => string;
  impostorBakePromise: Promise<void>;
}

function runtimeSearchParams(): URLSearchParams {
  return typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function runtimeFlag(searchParams: URLSearchParams, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
    if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  }
  return null;
}

function treeHardLodRequested(searchParams: URLSearchParams): boolean {
  const crossfade = runtimeFlag(searchParams, ["treeCrossfade", "treeCrossfadeEnabled"]);
  if (crossfade === false) return true;
  if (crossfade === true) return false;
  const hardLod = runtimeFlag(searchParams, ["treeHardLod", "treeHardLOD", "treeHardLods"]);
  if (hardLod !== null) return hardLod;
  const quality = searchParams.get("quality") ?? searchParams.get("qualityPreset") ?? searchParams.get("preset");
  return searchParams.get("treeGpuStrict") === "1" || quality === "perf" || quality === "potato";
}

function sanitizeRuntimeTreeConfig(config: TreeSettings): TreeSettings {
  const searchParams = runtimeSearchParams();
  const hardLod = treeHardLodRequested(searchParams);
  const ditherEnabled = config.lod.ditherEnabled === true && !hardLod;
  return stabilizeRuntimeTreeSettings({
    ...config,
    lod: {
      ...config.lod,
      crossfadeEnabled: config.lod.crossfadeEnabled && ditherEnabled,
      crossfadeBandM: ditherEnabled ? Math.max(0, config.lod.crossfadeBandM) : 0,
      ditherEnabled,
    },
    foliage: {
      ...config.foliage,
      enabled: false,
      alphaTest: 0,
      debugShowAlphaCards: false,
      oak: { ...config.foliage.oak },
      pine: { ...config.foliage.pine },
    },
    impostors: {
      ...config.impostors,
      fallbackToPlaceholder: false,
    },
  });
}

function formatTreeImpostorSummary(stats: TreeStats, settings: TreeSettings): string {
  if (!settings.impostors.enabled) return "disabled";
  const atlasSize = settings.impostors.resolutionPx * settings.impostors.octahedralGridSize;
  const memoryMiB = estimateTreeImpostorAtlasMemoryMiB(settings);
  const ready = stats.impostorStatus === "baked" ? "6/6" : "0/6";
  const reason = stats.impostorStatus === "fallback" && stats.impostorReason ? ` ${stats.impostorReason}` : "";
  return `${stats.impostorStatus} atlas=${ready} ${atlasSize}px ~${Math.round(memoryMiB)}MiB${reason}`;
}

function formatDeferredTreeImpostorSummary(settings: TreeSettings): string {
  const atlasSize = settings.impostors.resolutionPx * settings.impostors.octahedralGridSize;
  const memoryMiB = estimateTreeImpostorAtlasMemoryMiB(settings);
  return `deferred atlas=0/6 ${atlasSize}px ~${Math.round(memoryMiB)}MiB`;
}

export function runTreeStartup(input: TreeStartupInput): TreeStartupResult {
  const {
    scene, state, lod0Nodes, worldCells,
    isWebGpu, hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers, renderer,
  } = input;
  if (state.clodPerfMode) return runPerfModeTreeStartup(input);

  const treeConfig = sanitizeRuntimeTreeConfig(input.treeConfig);

  setTreeGpuRingHydrologyData(hydrologySystem ? packHydrologyData(hydrologySystem) : null);

  const treeStats = { current: null as TreeStats | null };

  const treeController = createTreeController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    treeConfig,
    webgpu: isWebGpu,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    terrainOcclusionSampler: input.terrainOcclusionSampler,
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
      state.treeImpostorSummary = formatTreeImpostorSummary(stats, treeConfig);
      statControllers.treeTotal?.updateDisplay();
      statControllers.treeVisiblePatches?.updateDisplay();
      statControllers.treeLodSummary?.updateDisplay();
      statControllers.treeGpuSummary?.updateDisplay();
      statControllers.treeImpostorSummary?.updateDisplay();
    },
  });
  const treeSystem = treeController.system;
  const fallingTrees = treeController.fallingTrees;
  treeController.refreshStats();

  const shouldBakeImpostorsOnStart = treeConfig.impostors.enabled &&
    treeConfig.impostors.bakeOnStart &&
    state.treeImpostorSwapOnBake;
  const impostorBakePromise = shouldBakeImpostorsOnStart
    ? treeController.bakeImpostors(renderer).then((result) => {
      if (!result.supported) console.info(`[trees] impostor baking fallback: ${result.reason ?? "unsupported"}`);
      else mountTreeImpostorLabFromWindow(scene, worldCells);
      treeController.refreshStats();
    }).catch((error) => {
      console.warn("[trees] impostor baking failed", error);
      treeController.refreshStats();
    })
    : Promise.resolve();
  if (!shouldBakeImpostorsOnStart && treeConfig.impostors.enabled && treeConfig.impostors.bakeOnStart) {
    state.treeImpostorSummary = formatDeferredTreeImpostorSummary(treeConfig);
    statControllers.treeImpostorSummary?.updateDisplay();
  }

  return {
    treeController, treeSystem, fallingTrees, treeStats, formatTreeGpuSummary, impostorBakePromise,
  };
}

function runPerfModeTreeStartup(input: TreeStartupInput): TreeStartupResult {
  const stats = createEmptyTreeSystemStats();
  const treeStats = { current: stats };
  input.state.treeTotal = formatTreeTotalDisplay(stats);
  input.state.treeVisiblePatches = "0/0";
  input.state.treeLodSummary = "0/0/0/0";
  input.state.treeGpuSummary = formatTreeGpuSummary(stats);
  input.state.treeImpostorSummary = "disabled";
  input.statControllers.treeTotal?.updateDisplay();
  input.statControllers.treeVisiblePatches?.updateDisplay();
  input.statControllers.treeLodSummary?.updateDisplay();
  input.statControllers.treeGpuSummary?.updateDisplay();
  input.statControllers.treeImpostorSummary?.updateDisplay();

  const disabledSettings: TreeSettings = { ...input.treeConfig, enabled: false };
  const system = {
    getStats: () => stats,
    updateSettings: () => undefined,
    rebuild: () => undefined,
    update: () => undefined,
    updateLighting: () => undefined,
    updateForestLighting: () => undefined,
    setEnabled: () => undefined,
    setDepthPrepassMaxLod: () => undefined,
    markPatchesDirty: () => undefined,
    getLightingProxies: () => [],
    getLightingProxiesBudgeted: () => ({ proxies: [], ready: true }),
    bakeImpostors: async () => ({ supported: false, reason: "disabled in CLOD perf mode" }),
    dispose: () => undefined,
  } as unknown as ReturnType<typeof createTreeController>["system"];

  const treeController = {
    system,
    fallingTrees: [],
    makeSettings: () => disabledSettings,
    applySettings: () => undefined,
    rebuild: () => undefined,
    refreshStats: () => undefined,
    update: () => undefined,
    updateLighting: () => undefined,
    setEnabled: () => undefined,
    setDepthPrepassMaxLod: () => undefined,
    markPatchesDirty: () => undefined,
    bakeImpostors: async () => ({ supported: false, reason: "disabled in CLOD perf mode" }),
    updateFallingTrees: () => undefined,
    dispose: () => undefined,
  } as ReturnType<typeof createTreeController>;

  return {
    treeController,
    treeSystem: system,
    fallingTrees: treeController.fallingTrees,
    treeStats,
    formatTreeGpuSummary,
    impostorBakePromise: Promise.resolve(),
  };
}
