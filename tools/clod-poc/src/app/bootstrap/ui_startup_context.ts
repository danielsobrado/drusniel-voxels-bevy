import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import type { Phase0Config } from "../../phase0/phase0_config.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import type { TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { ProjectArchiveContents } from "../../project/project_archive.js";
import type { TerrainTextureLoadOptions } from "../../terrain/material/texture_loader.js";
import type { VegetationDirtyQueue } from "../../systems/vegetation_dirty.js";
import type { ClodAppState } from "../clod_app_state.js";
import type { ClodRuntimeBindings } from "../clod_runtime_bindings.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import type { AppRenderer } from "./renderer_startup.js";
import type { DomShell } from "./dom_shell.js";
import type { RuntimeSystemsStartupResult, VegetationStatControllerRefs } from "./runtime/runtime_systems_startup.js";
import type { TerrainViewStartupResult } from "./terrain_view_startup.js";
import type { parseTreeConfig } from "../../trees/tree_config.js";
import type { parseUnderstoryConfig } from "../../understory/understory_config.js";
import type { GuiDisplayController } from "./bootstrap_refs.js";
import type { createPlayerInputController } from "../../player/player_input_controller.js";
import type { createPlayerModeController } from "../../player/player_mode_controller.js";

export interface UiStartupInput {
  dom: DomShell;
  searchParams: URLSearchParams;
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  WORLD: number;
  polishLine: string;
  buildStatusRef: { value: string };
  stagedImport: ProjectArchiveContents | null;
  state: ClodAppState;
  bindings: ClodRuntimeBindings;
  colorByLodUserOverride: { value: boolean };
  colorByLodController: { current: GuiDisplayController | null };
  terrainView: TerrainViewStartupResult;
  runtime: RuntimeSystemsStartupResult;
  statControllers: VegetationStatControllerRefs;
  app: AppRenderer;
  renderer: AppRenderer["renderer"];
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  terrainColliders: TerrainColliderSet;
  terrainRaycast: TerrainRaycastService;
  isWebGpu: boolean;
  worldCells: number;
  clodWorker: ClodWorkerClient;
  result: { nodesByLevel: Map<number, ClodPageNode[]> };
  allNodes: ClodPageNode[];
  maxTerrainLevel: number;
  markEditedAncestorsStale: (lod0Nodes: readonly ClodPageNode[]) => void;
  vegetationDirtyQueue: VegetationDirtyQueue;
  staleEditedAncestorIds: Set<string>;
  selectionQueryFlags: {
    queryGrassPerfScene: boolean;
    queryTreePerfScene: boolean;
    queryForestFloorScene: boolean;
  };
  longView: {
    hooks: ClodHooks | null;
    settleWaiters: { frames: number; resolve: () => void }[];
    isLongView: boolean;
    phase0TargetVisibleM: number;
    phase0Config: Phase0Config;
    queryScene: string | null;
    phase0VelocityX: number;
    phase0VelocityZ: number;
    phase0Streaming: Phase0Config["phase0"]["streaming"];
  };
  /** Optional far summary frame update callback. */
  onFarSummaryUpdate?: (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera) => void;
  getClodErrorCompute: () => import("../../gpu/clod_error_px_compute.js").ClodErrorPxCompute | null;
  ensureClodErrorCompute: () => Promise<void>;
  textureLoadOptions: TerrainTextureLoadOptions;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
}

export interface UiSessionState {
  averageFpsRef: { value: number };
  lastDigSummary: string;
  lastArchiveSummary: string;
  pendingParentNodes: number;
  pendingParentMs: number;
  pendingParentCount: number;
  terraformEditCheckbox: HTMLInputElement | null;
  weatherStatsController: GuiDisplayController | null;
  grassBladeCountController: GuiDisplayController | null;
  grassVisiblePatchesController: GuiDisplayController | null;
  grassTierSummaryController: GuiDisplayController | null;
  grassEdgeSuppressedController: GuiDisplayController | null;
  grassCandidateCountController: GuiDisplayController | null;
  digRadiusController: GuiDisplayController | null;
  playerInputController: ReturnType<typeof createPlayerInputController> | null;
  playerModeController: ReturnType<typeof createPlayerModeController> | null;
}

export interface UiStartupContext {
  input: UiStartupInput;
  session: UiSessionState;
}

export function createUiStartupContext(input: UiStartupInput): UiStartupContext {
  return {
    input,
    session: {
      averageFpsRef: { value: 0 },
      lastDigSummary: "",
      lastArchiveSummary: "",
      pendingParentNodes: 0,
      pendingParentMs: 0,
      pendingParentCount: 0,
      terraformEditCheckbox: null,
      weatherStatsController: null,
      grassBladeCountController: null,
      grassVisiblePatchesController: null,
      grassTierSummaryController: null,
      grassEdgeSuppressedController: null,
      grassCandidateCountController: null,
      digRadiusController: null,
      playerInputController: null,
      playerModeController: null,
    },
  };
}
