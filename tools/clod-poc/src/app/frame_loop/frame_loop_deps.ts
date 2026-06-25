import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { GrassStats, GrassSettings } from "../../grass.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";
import type { ForestLightingStats } from "../../forest_lighting/index.js";
import type { PostProcessSettings } from "../../environment/postprocess.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { NearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import type { PlayerInputController } from "../../player/player_input_controller.js";
import type { BrushPreviewController } from "../../player/brush_preview_controller.js";
import type { GrassController } from "../../runtime/vegetation/grass_controller.js";
import type { TreeController } from "../../runtime/vegetation/tree_controller.js";
import type { UnderstoryController } from "../../runtime/vegetation/understory_controller.js";
import type { ForestLightingController } from "../../runtime/forest_lighting/forest_lighting_controller.js";
import type { StoneController } from "../../runtime/vegetation/stone_controller.js";
import type { PropController } from "../../systems/prop_controller.js";
import type { WaterController } from "../../runtime/water_weather/water_controller.js";
import type { WeatherController } from "../../runtime/water_weather/weather_controller.js";
import type { NodeLabelOverlay } from "../../ui/node_labels.js";
import type { AppPostProcess } from "../app_post_process.js";
import type { AppSky } from "../../scene/app_sky.js";
import type { Phase0Config } from "../../phase0/phase0_config.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";
import type { StatsPresenter, GuiDisplayController } from "./stats_presenter.js";
import type { FrameRenderer } from "./frame_renderer.js";

interface TerrainFadeView {
  fade: number;
  target: number;
  mesh: THREE.Mesh;
  mat: { setFade: (fade: number, fadeIn: boolean, dither: boolean) => void };
}

interface NodeViewLookup {
  node: { id: string };
}

export interface FrameLoopRenderDeps {
  renderer: FrameRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  postProcess: AppPostProcess | null;
  currentPostProcessSettings: () => PostProcessSettings;
  nodeLabelOverlay: NodeLabelOverlay;
  skyEnvironment: AppSky | null;
  getHooks: () => ClodHooks | null;
  longViewSettleWaiters: { frames: number; resolve: () => void }[];
  profileFrameMs: number;
  grassProfileEnabled: boolean;
  grassPrepassEnabled: boolean;
  makeGrassSettings: () => GrassSettings;
}

export interface FrameLoopPlayerDeps {
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  state: ClodFrameLoopUiState;
  playerInputController: PlayerInputController;
  playerTerraformEditActive: () => boolean;
  brushPreview: BrushPreviewController;
  terrainRaycast: TerrainRaycastService;
}

export interface FrameLoopTerrainDeps {
  selectionController: ClodSelectionController;
  updateSelection: () => void;
  pageTransitionMode: string;
  crossfadeStep: number;
  nearFieldBubbleController: NearFieldBubbleController;
  views: Map<string, NodeViewLookup & TerrainFadeView>;
  worldCells: number;
}

export interface FrameLoopVegetationDeps {
  drainVegetationDirtyQueue: () => void;
  treeController: TreeController;
  grassController: GrassController;
  understoryController: UnderstoryController;
  forestLightingController: ForestLightingController;
  applyForestLightingToPropMaterials: () => void;
  stoneController: StoneController;
  propController: PropController | null;
  grassSystem: GrassController["system"];
  treeSystem: TreeController["system"];
  understorySystem: UnderstoryController["system"];
  forestLightingSystem: ForestLightingController["system"];
  stoneSystem: StoneController["system"];
  currentLighting: () => { sunDirection: THREE.Vector3 };
}

export interface FrameLoopWaterWeatherDeps {
  waterController: WaterController;
  weatherController: WeatherController;
  updateWeatherStats: () => void;
  weatherStatsController: GuiDisplayController | null;
}

export interface FrameLoopStatsDeps {
  getGrassStats: () => GrassStats | null;
  setGrassStats: (stats: GrassStats | null) => void;
  getTreeStats: () => TreeStats | null;
  setTreeStats: (stats: TreeStats | null) => void;
  getStoneStats: () => StoneStats | null;
  setStoneStats: (stats: StoneStats | null) => void;
  getUnderstoryStats: () => UnderstoryStats | null;
  setUnderstoryStats: (stats: UnderstoryStats | null) => void;
  getForestLightingStats: () => ForestLightingStats | null;
  setForestLightingStats: (stats: ForestLightingStats | null) => void;
  formatTreeGpuSummary: (stats: TreeStats) => string;
  formatUnderstoryGpuSummary: (stats: UnderstoryStats) => string;
  statsPresenter: StatsPresenter;
  updateInfo: () => void;
  averageFpsRef: { value: number };
}

export interface FrameLoopDiagnosticsDeps {
  maxTerrainLevel: number;
  farShellBuilt: () => boolean;
  farShellCanopyEnabled: () => boolean;
  isLongView: boolean;
  phase0TargetVisibleM: number;
  phase0Config: Phase0Config;
  queryScene: string | null;
  phase0VelocityX: number;
  phase0VelocityZ: number;
  phase0Streaming: Phase0Config["phase0"]["streaming"];
  longViewDiagnosticsCfg: {
    page: { chunk_size: number; chunks_per_page: number };
  };
  getFarShellRadiusFactor: () => number;
}

export interface FrameLoopFarSummaryDeps {
  /** Called each frame after terrain phase but before vegetation phase. */
  onFarSummaryUpdate?: (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera) => void;
}

export interface ClodFrameLoopDeps {
  render: FrameLoopRenderDeps;
  player: FrameLoopPlayerDeps;
  terrain: FrameLoopTerrainDeps;
  vegetation: FrameLoopVegetationDeps;
  waterWeather: FrameLoopWaterWeatherDeps;
  stats: FrameLoopStatsDeps;
  diagnostics: FrameLoopDiagnosticsDeps;
  farSummary?: FrameLoopFarSummaryDeps;
}
