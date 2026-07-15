import { initHydrologyAtlasGpu, resetHydrologyAtlasGpu } from "../../gpu/hydrology_atlas_gpu.js";
import { resolveVegetationGpuBackend } from "./vegetation_gpu_backend.js";
import { runGrassStartup } from "./grass_startup.js";
import { runStoneStartup } from "./stone_startup.js";
import { runTreeStartup } from "./tree_startup.js";
import { runUnderstoryStartup } from "./understory_startup.js";
import type {
  VegetationStartupInput,
  VegetationStartupResult,
  GuiDisplayController,
  VegetationStatControllerRefs,
} from "./vegetation_types.js";

export type { GuiDisplayController, VegetationStatControllerRefs, VegetationStartupResult, VegetationStartupInput };

export function runVegetationStartup(input: VegetationStartupInput): VegetationStartupResult {
  const {
    app, scene, controls, state, lod0Nodes, worldCells, worldSeed, unboundedWorld,
    grassConfig, stoneConfig, treeConfig, understoryConfig,
    queryGrassRingGrid, queryGrassRingCell,
    isWebGpu, rendererWebGpuDevice,
    hydrologySystem, terrainOcclusionSampler, currentLighting, statControllers,
    searchParams,
  } = input;

  const gpuBackend = resolveVegetationGpuBackend(app.renderer, isWebGpu);

  // Streaming hydrology atlas (Phase 4b): must exist before any ring compute is created
  // so their bind groups capture the real atlas texture instead of the 1×1 fallback.
  const atlasSource = hydrologySystem?.tileAtlasSource() ?? null;
  if (rendererWebGpuDevice && atlasSource) {
    initHydrologyAtlasGpu(rendererWebGpuDevice, atlasSource);
  } else {
    resetHydrologyAtlasGpu();
  }

  const grass = runGrassStartup({
    app, scene, controls, state, lod0Nodes, worldCells, grassConfig,
    queryGrassRingGrid, queryGrassRingCell,
    isWebGpu, rendererWebGpuDevice, gpuBackend,
    hydrologySystem, currentLighting, statControllers,
  });

  const stone = runStoneStartup({
    scene, state, lod0Nodes, worldCells, stoneConfig,
    hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers,
  });

  const tree = runTreeStartup({
    scene, state, lod0Nodes, worldCells, treeConfig,
    isWebGpu, hydrologySystem, rendererWebGpuDevice, gpuBackend,
    terrainOcclusionSampler,
    currentLighting, statControllers, renderer: app.renderer,
  });

  const understory = runUnderstoryStartup({
    scene, state, lod0Nodes, worldCells, worldSeed, unboundedWorld, understoryConfig,
    isWebGpu, hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers,
    searchParams,
  });

  return {
    ...grass,
    ...stone,
    ...tree,
    ...understory,
    onStoneScatterComplete: stone.onStoneScatterComplete,
    formatTreeGpuSummary: tree.formatTreeGpuSummary,
    formatUnderstoryGpuSummary: understory.formatUnderstoryGpuSummary,
  };
}
