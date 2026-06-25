import type { ForestLightingStats } from "../../../forest_lighting/index.js";
import { createForestLightingController } from "../../../runtime/forest_lighting/forest_lighting_controller.js";
import type { ClodAppState } from "../../clod_app_state.js";
import { forestLightingUiState } from "../../clod_app_state.js";
import type { VegetationStatControllerRefs, VegetationStartupResult } from "../../../runtime/vegetation/vegetation_types.js";

export interface ForestLightingStartupInput {
  worldCells: number;
  forestLightingConfig: ReturnType<typeof import("../../../forest_lighting/index.js").parseForestLightingConfig>;
  state: ClodAppState;
  treeSystem: VegetationStartupResult["treeSystem"];
  understorySystem: VegetationStartupResult["understorySystem"];
  statControllers: VegetationStatControllerRefs;
}

export interface ForestLightingStartupResult {
  forestLightingController: ReturnType<typeof createForestLightingController>;
  forestLightingSystem: ReturnType<typeof createForestLightingController>["system"];
  forestLightingStats: { current: ForestLightingStats | null };
  applyForestLightingToPropMaterials: () => void;
}

export function runForestLightingStartup(
  input: ForestLightingStartupInput,
): ForestLightingStartupResult {
  const { worldCells, forestLightingConfig, state, treeSystem, understorySystem, statControllers } = input;

  const forestLightingStats = { current: null as ForestLightingStats | null };
  const forestLightingController = createForestLightingController({
    worldCells,
    forestLightingConfig,
    getUiState: () => forestLightingUiState(state),
    getTreeSystem: () => treeSystem,
    getUnderstorySystem: () => understorySystem,
    syncStatsToState: (stats, statsText) => {
      forestLightingStats.current = stats;
      state.forestLightingStats = statsText;
      statControllers.forestLightingStats?.updateDisplay();
    },
  });
  const forestLightingSystem = forestLightingController.system;
  const applyForestLightingToPropMaterials = () => forestLightingController.applyToPropMaterials();
  forestLightingStats.current = forestLightingSystem.getStats();

  return {
    forestLightingController,
    forestLightingSystem,
    forestLightingStats,
    applyForestLightingToPropMaterials,
  };
}
