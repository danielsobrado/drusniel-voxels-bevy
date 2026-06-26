import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import { createClodRuntimeBindings } from "../clod_runtime_bindings.js";
import type { VegetationStatControllerRefs } from "./runtime/runtime_systems_startup.js";

export type GuiDisplayController = { updateDisplay: () => unknown };

export interface BootstrapUiRefs {
  bindings: ReturnType<typeof createClodRuntimeBindings>;
  colorByLodUserOverride: { value: boolean };
  colorByLodController: { current: GuiDisplayController | null };
  statControllers: VegetationStatControllerRefs;
}

export function createBootstrapUiRefs(stagedImport: VoxelProjectArchiveContents | null): BootstrapUiRefs {
  return {
    bindings: createClodRuntimeBindings(),
    colorByLodUserOverride: { value: stagedImport !== null },
    colorByLodController: { current: null },
    statControllers: {
      stoneTotal: null,
      stoneClassSummary: null,
      stoneVisible: null,
      treeTotal: null,
      treeVisiblePatches: null,
      treeLodSummary: null,
      treeGpuSummary: null,
      understoryTotal: null,
      understoryVisiblePatches: null,
      understoryClassSummary: null,
      understoryGpuSummary: null,
      forestLightingStats: null,
    },
  };
}
