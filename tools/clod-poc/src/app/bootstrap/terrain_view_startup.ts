import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createClodSceneState } from "../../config/clod_scene_state.js";
import type { ClodPageNode } from "../../types.js";
import { toGeometry } from "../../three/geometry.js";
import type { PageGeometryNormalMode } from "../../terrain/page_geometry_cache.js";
import { recomputedNormalsFor } from "../../terrain/page_geometry_normals.js";
import { createClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { ClodSelectionTerrainView } from "../../terrain/selection/clod_selection_controller.js";
import { createNodeLabelOverlay } from "../../ui/node_labels.js";
import { createTerrainTextureController } from "../../terrain/texture/terrain_texture_controller.js";
import type { ClodFrameLoopUiState } from "../frame_loop/ui_state.js";
import { LockedBorderOverlay } from "../../ui/locked_border_overlay.js";
import { createNearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import { PageGeometryCache } from "../../terrain/page_geometry_cache.js";
import { RenderNodeCache } from "../../terrain/render_node_cache.js";
import { ClodApplyQueue, type ClodGeometryApplyResult } from "../../terrain/clod_apply_queue.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import { createFarShellController } from "../../long-view/farShellController.js";
import type { FarShellConfig } from "../../long-view/farShellConfig.js";
import { createCanopyShellSystem } from "../../canopy/canopy_shell_system.js";
import type { CanopyShellConfig } from "../../canopy/canopy_shell_config.js";
import { createCanopyDebugState, applyConfigToCanopyDebugState } from "../../canopy/canopy_debug.js";
import { createShadowProxyController } from "../../shadows/shadowProxyController.js";
import { createShadowProxyDebugState } from "../../shadows/shadowProxyDebug.js";
import type { ShadowProxyController } from "../../shadows/shadowProxyTypes.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { TerrainColliders } from "../../terrain/colliders.js";
import type { BrushPreview } from "../../editing/brush_preview.js";
import type { TerrainMaterialController } from "../../terrain/materials/terrain_material_controller.js";
import type { WebGpuSelectionResources } from "./webgpu_selection_startup.js";
import type { AppPostProcess } from "../app_post_process.js";
import type { SkyEnvironment } from "../../environment/sky.js";
import type { TerrainColorAdjustments, EnvironmentSettings, PostProcessSettings, LightingSettings } from "../../environment/postprocess.js";
import type { ClodErrorPxCompute } from "../../gpu/clod_error_px_compute.js";

export interface TerrainViewStartupInput {
  state: ClodFrameLoopUiState;
  roots: ClodPageNode[];
  allNodes: ClodPageNode[];
  worldCells: number;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  terrainColliders: TerrainColliders;
  brushPreview: BrushPreview;
  materialController: TerrainMaterialController;
  webGpuSelectionResources: WebGpuSelectionResources;
  clodRuntime: ClodRuntimeConfig;
  postProcess: AppPostProcess | null;
  skyEnvironment: SkyEnvironment;
  currentTerrainColorAdjustments: () => TerrainColorAdjustments;
  currentEnvironmentSettings: () => EnvironmentSettings;
  currentPostProcessSettings: () => PostProcessSettings;
  currentLighting: () => LightingSettings;
  getFarClipmapTexture?: () => THREE.Texture | null;
  createFarShellConfig: () => FarShellConfig;
  createCanopyConfig: () => CanopyShellConfig;
  createShadowProxyConfig: () => import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig;
}

export interface NodeView extends ClodSelectionTerrainView {
  sourceNormals: Float32Array;
  recomputedNormals: Float32Array | null;
}

export interface TerrainViewStartupResult {
  postProcess: AppPostProcess | null;
  skyEnvironment: SkyEnvironment;
  currentTerrainColorAdjustments: () => TerrainColorAdjustments;
  currentEnvironmentSettings: () => EnvironmentSettings;
  currentPostProcessSettings: () => PostProcessSettings;
  currentLighting: () => LightingSettings;
  views: Map<string, NodeView>;
  textureController: ReturnType<typeof createTerrainTextureController>;
  materialController: TerrainMaterialController;
  applyTerrainTextures: () => void;
  applyColorByLodToMaterials: () => void;
  applyColorAdjustmentsToTerrain: () => void;
  farShellController: ReturnType<typeof createFarShellController>;
  canopyShellSystem: ReturnType<typeof createCanopyShellSystem>;
  canopyDebugState: ReturnType<typeof createCanopyDebugState> | null;
  getCanopyConfig: () => CanopyShellConfig;
  setCanopyConfig: (config: CanopyShellConfig) => void;
  shadowProxyController: ShadowProxyController;
  shadowProxyDebugState: ReturnType<typeof createShadowProxyDebugState> | null;
  getShadowProxyConfig: () => import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig;
  setShadowProxyConfig: (config: import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig) => void;
  boundaryGroup: THREE.Group;
  seamGroup: THREE.Group;
  crossLodBorderGroup: THREE.Group;
  lockedBorderOverlay: LockedBorderOverlay;
  nodeLabelOverlay: ReturnType<typeof createNodeLabelOverlay>;
  brushPreview: BrushPreview;
  nearFieldBubbleController: ReturnType<typeof createNearFieldBubbleController>;
  pageGeometryCache: PageGeometryCache;
  renderNodeCache: RenderNodeCache<NodeView>;
  pageTransitionMode: "instant" | "fade";
  crossfadeStep: number;
  selectionController: ReturnType<typeof createClodSelectionController>;
  updateSelection: () => void;
  cutChangedRef: { value: number; fn: () => void };
  applyNodeMesh: (node: ClodPageNode) => { geometrySwapMs: number; colliderMs: number };
  applyNodeGeometry: (node: ClodPageNode) => ClodGeometryApplyResult;
  applyNodeCollider: (node: ClodPageNode) => number;
  clodApplyQueue: ClodApplyQueue;
  drainClodApplyQueue: () => void;
  getClodApplyStats: () => ReturnType<ClodApplyQueue["stats"]>;
  setViewNormalMode: (view: NodeView, normalMode: PageGeometryNormalMode) => void;
}

function triangleCount(mesh: ClodPageNode["mesh"]): number {
  return mesh.indices.length / 3;
}

function createView(
  node: ClodPageNode,
  frameId: number,
  input: TerrainViewStartupInput,
  pageGeometryCache: PageGeometryCache,
): NodeView {
  const material = input.materialController.create(node.level, node.mesh.materials);
  const geometry = pageGeometryCache.getOrCreate({ node, normalMode: "source", createGeometry: () => toGeometry(node.mesh) });
  const mesh = new THREE.Mesh(geometry, material.material);
  pageGeometryCache.setGeometryActive(geometry, true);
  mesh.frustumCulled = true;
  mesh.visible = false;
  input.scene.add(mesh);
  return {
    node,
    selected: false,
    fade: 0,
    target: 0,
    mesh,
    mat: material,
    sourceNormals: node.mesh.normals,
    recomputedNormals: null,
  };
}

function selectionCenter(interaction: PlayerInteractionState, player: PlayerController, camera: THREE.PerspectiveCamera): THREE.Vector3 {
  return interaction.mode === "playing" ? player.position : camera.position;
}

export function createTerrainViewStartup(input: TerrainViewStartupInput): TerrainViewStartupResult {
  const { state, camera, player, interaction } = input;
  const clodRuntime = input.clodRuntime;
  const views = new Map<string, NodeView>();
  const pageGeometryCache = new PageGeometryCache(clodRuntime.pageGeometryCache);
  const renderNodeCache = new RenderNodeCache<NodeView>({
    config: clodRuntime.renderNodeCache,
    create: (node, frameId) => createView(node, frameId, input, pageGeometryCache),
    dispose: (view) => {
      if (pageGeometryCache.owns(view.mesh.geometry as THREE.BufferGeometry)) {
        pageGeometryCache.setGeometryActive(view.mesh.geometry as THREE.BufferGeometry, false);
      } else {
        view.mesh.geometry.dispose();
      }
      if (Array.isArray(view.mesh.material)) view.mesh.material.forEach((m) => m.dispose());
      else view.mesh.material.dispose();
      input.scene.remove(view.mesh);
      views.delete(view.node.id);
    },
    frameId: () => selectionController.stats().frameId,
    warn: (message) => console.warn(message),
  });
  const nodeLabelOverlay = createNodeLabelOverlay();
  const textureController = createTerrainTextureController({
    enabled: Boolean(state.colorByBiome || state.colorByMaterial),
    scene: input.scene,
    worldCells: input.worldCells,
    controls: input.controls,
    renderer: input.renderer,
    getFarClipmapTexture: input.getFarClipmapTexture,
  });
  const applyTerrainTextures = () => {
    textureController.updateConfig(Boolean(state.colorByBiome || state.colorByMaterial));
    textureController.update(input.controls.target.x, input.controls.target.z);
  };
  const applyColorByLodToMaterials = () => input.materialController.applyColorByLod(state.colorByLod);
  const applyColorAdjustmentsToTerrain = () => input.materialController.applyColorAdjustments(input.currentTerrainColorAdjustments());

  const boundaryGroup = new THREE.Group();
  const seamGroup = new THREE.Group();
  const crossLodBorderGroup = new THREE.Group();
  input.scene.add(boundaryGroup, seamGroup, crossLodBorderGroup);
  const lockedBorderOverlay = new LockedBorderOverlay();
  input.scene.add(lockedBorderOverlay.object);

  const pageTransitionMode = state.pageTransition ? "fade" : "instant";
  const crossfadeStep = Math.max(0.05, Math.min(1, state.fadeSpeed));
  const staleEditedAncestorIds = new Set<string>();
  const cutChangedRef = { value: 0, fn: () => { cutChangedRef.value++; } };
  const farShellController = createFarShellController({
    scene: input.scene,
    camera,
    cfg: {
      page: { chunk_size: 32, chunks_per_page: 4 },
      world: { size_chunks: 512, seed: 1337 },
    },
    height: state.farShellHeight,
    skirt: state.farShellSkirt,
    radiusFactor: state.farShellRadiusFactor,
    enabled: state.farShell,
    wireframe: state.wire,
    getFarClipmapTexture: input.getFarClipmapTexture,
  });
  let liveCanopyConfig = input.createCanopyConfig();
  let liveShadowProxyConfig = input.createShadowProxyConfig();
  const canopyShellSystem = createCanopyShellSystem({
    scene: input.scene,
    getConfig: () => liveCanopyConfig,
    getFarShellMetrics: () => farShellController.metrics(),
  });
  const canopyDebugState = state.canopyDebug ? createCanopyDebugState(canopyShellSystem.object, liveCanopyConfig) : null;
  if (canopyDebugState) applyConfigToCanopyDebugState(canopyDebugState, liveCanopyConfig);
  const shadowProxyController = createShadowProxyController({
    scene: input.scene,
    getConfig: () => liveShadowProxyConfig,
    getFarShellMetrics: () => farShellController.metrics(),
  });
  const shadowProxyDebugState = state.clodShadowProxyDebug ? createShadowProxyDebugState(shadowProxyController.mesh, liveShadowProxyConfig) : null;

  const getClodErrorCompute = (): ClodErrorPxCompute | null => input.webGpuSelectionResources.compute;
  const prefetchNodes = clodRuntime.renderNodeCache.enabled
    ? (nodes: readonly ClodPageNode[], frameId: number): void => renderNodeCache.prefetch(nodes, frameId)
    : undefined;
  const selectionController = createClodSelectionController({
    config: {
      clodRuntime,
      hysteresisMergeFactor: 0.7,
      chunksPerPage: 4,
      chunkSize: 32,
      readbackMode: input.webGpuSelectionResources.readbackMode,
      forceContinuousParity: input.webGpuSelectionResources.forceContinuousParity,
      webGpuUnavailableReason: input.webGpuSelectionResources.unavailableReason,
      poolTerrainMaterial: input.materialController.poolEnabled,
    },
    roots: input.roots,
    allNodes: input.allNodes,
    views,
    getOrCreateView: (node, frameId) => renderNodeCache.getOrCreate({ node, frameId }),
    markActiveNodes: (nodeIds, frameId) => renderNodeCache.markActive(nodeIds, frameId),
    prefetchNodes,
    getClodErrorCompute,
    getSettings: () => ({
      thresholdPx: state.thresholdPx,
      enforce21: state.enforce21,
      freezeSelection: (state as any).freezeSelection ?? false,
      neighborLevelDeltaMax: (state as any).neighborLevelDeltaMax ?? 1,
      bubble: state.bubble,
      bubbleRadius: state.bubbleRadius,
      forceMaxLevel: state.forceMaxLevel as number | "auto",
      webgpuSelection: state.webgpuSelection,
      showBounds: state.showBounds,
      showSeamPoints: state.showSeamPoints,
      showCrossLodBorders: state.showCrossLodBorders,
      showLockedBorderVertices: state.showLockedBorderVertices,
      materialTiers: state.materialTiers,
    }),
    getSelectionCenter: () => selectionCenter(interaction, player, camera),
    renderer: input.renderer,
    camera,
    overlays: { boundaryGroup, seamGroup, crossLodBorderGroup },
    lockedBorderOverlay,
    staleEditedAncestorIds,
    onCutChanged: () => cutChangedRef.fn(),
  });
  const updateSelection = () => selectionController.update();

  const geometryForView = (view: NodeView, normalMode: PageGeometryNormalMode) => (
    pageGeometryCache.getOrCreateWithResult({
      node: view.node,
      normalMode,
      createGeometry: () => {
        const geometry = toGeometry(view.node.mesh);
        if (normalMode === "recomputed") {
          geometry.setAttribute("normal", new THREE.BufferAttribute(recomputedNormalsFor(view), 3));
        }
        return geometry;
      },
    })
  );

  const assignViewGeometry = (
    view: NodeView,
    geometry: THREE.BufferGeometry,
    previousWasCacheOwned = pageGeometryCache.owns(view.mesh.geometry as THREE.BufferGeometry),
  ): void => {
    const previous = view.mesh.geometry as THREE.BufferGeometry;
    if (previous === geometry) {
      pageGeometryCache.setGeometryActive(geometry, true);
      return;
    }
    if (previousWasCacheOwned) pageGeometryCache.setGeometryActive(previous, false);
    else previous.dispose();
    view.mesh.geometry = geometry;
    pageGeometryCache.setGeometryActive(geometry, true);
  };

  const setViewNormalMode = (view: NodeView, normalMode: PageGeometryNormalMode): void => {
    assignViewGeometry(view, geometryForView(view, normalMode).geometry);
  };

  const applyNodeGeometry = (node: ClodPageNode): ClodGeometryApplyResult => {
    const v = views.get(node.id);
    if (!v) {
      return { applied: false, geometryMs: 0, materialMs: 0, triangles: triangleCount(node.mesh), reusedGeometry: false };
    }
    const gs = performance.now();
    const previousWasCacheOwned = pageGeometryCache.owns(v.mesh.geometry as THREE.BufferGeometry);
    v.node = node;
    v.sourceNormals = node.mesh.normals;
    v.recomputedNormals = null;
    const normalMode: PageGeometryNormalMode = state.recomputedNormals ? "recomputed" : "source";
    const geometryResult = geometryForView(v, normalMode);
    assignViewGeometry(v, geometryResult.geometry, previousWasCacheOwned);
    return {
      geometryMs: performance.now() - gs,
      materialMs: 0,
      triangles: triangleCount(node.mesh),
      reusedGeometry: geometryResult.cacheHit,
    };
  };

  const applyNodeCollider = (node: ClodPageNode): number => {
    if (node.level !== 0) return 0;
    const tc = performance.now();
    input.terrainColliders.updatePage(node.id, node.mesh);
    nearFieldBubbleController.invalidatePage(node.id);
    return performance.now() - tc;
  };

  const applyNodeMesh = (node: ClodPageNode): { geometrySwapMs: number; colliderMs: number } => {
    const geometry = applyNodeGeometry(node);
    const colliderMs = node.level === 0 ? applyNodeCollider(node) : 0;
    return { geometrySwapMs: geometry.geometryMs, colliderMs };
  };

  const clodApplyQueue = new ClodApplyQueue({
    budget: clodRuntime.clodApply,
    applyGeometry: applyNodeGeometry,
    applyCollider: applyNodeCollider,
    getFrameId: () => selectionController.stats().frameId,
    getCameraPosition: () => {
      const p = interaction.mode === "playing" ? player.position : input.controls.target;
      return { x: p.x, z: p.z };
    },
    isNodeVisible: (nodeId) => {
      const view = views.get(nodeId);
      return Boolean(view && (view.mesh.visible || view.fade > 0.001 || view.target > 0));
    },
    onGeometryApplied: (node) => {
      staleEditedAncestorIds.delete(node.id);
      selectionController.patchNodes([node]);
      selectionController.invalidate();
    },
  });

  return {
    postProcess: input.postProcess,
    skyEnvironment: input.skyEnvironment,
    currentTerrainColorAdjustments: input.currentTerrainColorAdjustments,
    currentEnvironmentSettings: input.currentEnvironmentSettings,
    currentPostProcessSettings: input.currentPostProcessSettings,
    currentLighting: input.currentLighting,
    views,
    textureController,
    materialController: input.materialController,
    applyTerrainTextures,
    applyColorByLodToMaterials,
    applyColorAdjustmentsToTerrain,
    farShellController,
    canopyShellSystem,
    canopyDebugState,
    getCanopyConfig: () => liveCanopyConfig,
    setCanopyConfig: (config: CanopyShellConfig) => {
      liveCanopyConfig = { ...config };
      if (canopyDebugState) {
        applyConfigToCanopyDebugState(canopyDebugState, config);
      }
    },
    shadowProxyController,
    shadowProxyDebugState,
    getShadowProxyConfig: () => liveShadowProxyConfig,
    setShadowProxyConfig: (config: import("../../shadows/shadowProxyTypes.js").ShadowProxyConfig) => {
      liveShadowProxyConfig = { ...config };
    },
    boundaryGroup,
    seamGroup,
    crossLodBorderGroup,
    lockedBorderOverlay,
    nodeLabelOverlay,
    brushPreview: input.brushPreview,
    nearFieldBubbleController,
    pageGeometryCache,
    renderNodeCache,
    pageTransitionMode,
    crossfadeStep,
    selectionController,
    updateSelection,
    cutChangedRef,
    applyNodeMesh,
    applyNodeGeometry,
    applyNodeCollider,
    clodApplyQueue,
    drainClodApplyQueue: () => clodApplyQueue.drain(),
    getClodApplyStats: () => clodApplyQueue.stats(),
    setViewNormalMode,
  };
}
