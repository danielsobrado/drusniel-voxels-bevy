import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodPageNode } from "../../types.js";
import type { GrassSettings, GrassStats } from "../../grass.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";
import type { HydrologySystem } from "../../water/index.js";
import type { EnvironmentLighting } from "../../environment.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import type { AppRenderer } from "../../app/bootstrap/renderer_startup.js";
import type { createGrassController } from "./grass_controller.js";
import type { createStoneController } from "./stone_controller.js";
import type { createTreeController } from "./tree_controller.js";
import type { createUnderstoryController } from "./understory_controller.js";

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
  forestLightingStats: GuiDisplayController | null;
}

export interface VegetationStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  controls: OrbitControls;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  grassConfig: ReturnType<typeof import("../../grass.js").parseGrassConfig>;
  stoneConfig: ReturnType<typeof import("../../stones/stone_config.js").parseStoneConfig>;
  treeConfig: ReturnType<typeof import("../../trees/index.js").parseTreeConfig>;
  understoryConfig: ReturnType<typeof import("../../understory/index.js").parseUnderstoryConfig>;
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
