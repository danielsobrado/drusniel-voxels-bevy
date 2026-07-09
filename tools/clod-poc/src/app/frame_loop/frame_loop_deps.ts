import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { GrassStats, GrassSettings } from "../../grass.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";
import type { ForestLightingStats } from "../../forest_lighting/index.js";
import type { PropStats } from "../../props/prop_stats.js";
import type { PostProcessSettings } from "../../environment/postprocess.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { NearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { StreamingClodRootController } from "../../terrain/streaming/clod_streaming_roots.js";
import type { FarClipmapOwnershipSnapshot } from "../../terrain/far_clipmap/index.js";
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
import type { TerrainColliderSet } from "../../terrain/terrain_collider.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";
import type { StatsPresenter, GuiDisplayController } from "./stats_presenter.js";
import type { FrameRenderer } from "./frame_renderer.js";
import type { GpuPassTiming } from "../../core/gpu_pass_timing.js";
import type { FloatingOriginController } from "../../precision/floating_origin.js";
import type { PageGeometryCacheStats } from "../../terrain/geometry/page_geometry_cache.js";
import type { ClodRenderNodeCacheStats } from "../../terrain/rendering/clod_render_node_cache.js";
import type { ClodApplyStatsSnapshot } from "../../terrain/rendering/clod_apply_stats.js";
import type { DynamicResolutionController } from "../../rendering/dynamic_resolution.js";
import type { StatsSyncThrottleConfig } from "./stats_sync_throttle.js";

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
  dynamicResolution?: DynamicResolutionController | null;
  /** TP-1 per-pass GPU timing collector (null on WebGL / unsupported). */
  gpuPassTiming?: GpuPassTiming | null;
  /** TP-1 gated offscreen tree-timing pass; runs after the visible frame. */
  runGpuTreeTiming?: (() => void) | null;
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
  streamingClodRootController?: StreamingClodRootController | null;
  views: Map<string, NodeViewLookup & TerrainFadeView>;
  worldCells: number;
  pruneRenderNodeCache?: (protectedNodeIds: ReadonlySet<string>, frameId: number) => void;
  getClodReadyPageKeys?: () => Iterable<string>;
  drainClodApplyQueue?: () => ClodApplyStatsSnapshot;
  getClodApplyStats?: () => ClodApplyStatsSnapshot;
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
  propStats: { current: PropStats | null } | null;
  currentLighting: () => { sunDirection: THREE.Vector3; skyLight: THREE.Color };
}

export interface FrameLoopWaterWeatherDeps {
  waterController: WaterController;
  deepOceanSurface: import("../../water/deep_ocean_surface.js").DeepOceanSurface | null;
  deepOceanMaterial: import("../../water/deep_ocean_material.js").DeepOceanMaterialHandle | null;
  waterField: import("../../water/waterField.js").WaterField;
  deepOceanConfig: import("../../terrain/border_coast_config.js").DeepOceanRenderConfig;
  deepOceanMeshPresent: boolean;
  oceanSampler: import("../../water/ocean_service.js").OceanSampler | null;
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
  getPageGeometryCacheStats?: () => PageGeometryCacheStats;
  getRenderNodeCacheStats?: () => ClodRenderNodeCacheStats;
  statsPresenter: StatsPresenter;
  updateInfo: () => void;
  averageFpsRef: { value: number };
  statsSyncThrottleConfig: StatsSyncThrottleConfig;
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
  getShadowProxyInert: () => number;
  getShadowProxyEnabled: () => number;
  getFarShellMetrics?: () => import("../../long-view/farShellMetrics.js").FarShellMetrics | undefined;
  infiniteFarShellActive?: () => boolean;
  getFarClipmapOwnershipSnapshot?: () => FarClipmapOwnershipSnapshot | undefined;
}

export interface FrameLoopFarSummaryDeps {
  /** Called each frame after terrain phase but before vegetation phase. `worldCenter` is the
   *  canonical frame center (player/orbit target) — far clipmap rings + far shell anchor to it so
   *  they stay aligned with the near bubble instead of drifting to the camera eye. */
  onFarSummaryUpdate?: (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera, worldCenter: THREE.Vector3) => void;
}

export interface FrameLoopFloatingOriginDeps {
  controller: FloatingOriginController;
  terrainColliders: TerrainColliderSet;
}

export interface FrameLoopShadowProxyDeps {
  rebuildIfNeeded: () => void;
}

export interface FrameLoopCanopyDeps {
  update: (cameraX: number, cameraZ: number) => void;
}

export interface FrameLoopClodShadowDeps {
  update: () => void;
  statsController?: { updateDisplay: () => unknown } | null;
  isActive: () => boolean;
}

export interface FrameLoopConstructionDeps {
  update: () => void;
  isActive: () => boolean;
}

export interface FrameLoopCombatDeps {
  update: (timeMs: number) => void;
}

export interface FrameLoopSpellsDeps {
  update: (timeMs: number) => void;
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
  floatingOrigin?: FrameLoopFloatingOriginDeps;
  shadowProxy?: FrameLoopShadowProxyDeps;
  clodShadow?: FrameLoopClodShadowDeps;
  canopy?: FrameLoopCanopyDeps;
  construction?: FrameLoopConstructionDeps;
  combat?: FrameLoopCombatDeps;
  spells?: FrameLoopSpellsDeps;
}
