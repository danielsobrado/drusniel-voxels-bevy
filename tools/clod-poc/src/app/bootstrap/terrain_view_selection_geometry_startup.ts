import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { triangleCount, type ClodPageNode } from "../../types.js";
import { toGeometry } from "../../terrain/geometry/page_geometry.js";
import {
  PageGeometryCache,
  type PageGeometryNormalMode,
} from "../../terrain/geometry/page_geometry_cache.js";
import type { ClodRenderNodeCache } from "../../terrain/rendering/clod_render_node_cache.js";
import {
  ClodApplyQueue,
  type ClodGeometryApplyResult,
} from "../../terrain/rendering/clod_apply_queue.js";
import type { ClodApplyStatsSnapshot } from "../../terrain/rendering/clod_apply_stats.js";
import { createClodSelectionController, type ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { LockedBorderOverlay } from "../../ui/locked_border_overlay.js";
import type { WebGpuReadbackMode } from "../../core/webgpu_readback_mode.js";
import type { ClodErrorPxCompute } from "../../gpu/clod_error_px_compute.js";
import type { TerrainColliderSet } from "../../terrain/terrain_collider.js";
import { getDigEditRevision } from "../../terrain/terrain.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import type { ClodAppState } from "../clod_app_state.js";
import type { NodeView } from "./bootstrap_types.js";
import { recomputedNormalsFor } from "./bootstrap_types.js";

export interface TerrainViewSelectionGeometryStartupInput {
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  allNodes: ClodPageNode[];
  roots: ClodPageNode[];
  views: Map<string, NodeView>;
  renderNodeCache: ClodRenderNodeCache;
  pageGeometryCache: PageGeometryCache;
  state: ClodAppState;
  camera: THREE.PerspectiveCamera;
  renderer: import("./renderer_startup.js").AppRenderer["renderer"];
  interaction: PlayerInteractionState;
  player: PlayerController;
  terrainColliders: TerrainColliderSet;
  getClodErrorCompute: () => ClodErrorPxCompute | null;
  getWebGpuUnavailableReason: () => string | null;
  queryReadbackMode: WebGpuReadbackMode;
  queryWebGpuParity: boolean;
  poolTerrainMaterial: boolean;
  staleEditedAncestorIds: Set<string>;
  boundaryGroup: THREE.Group;
  seamGroup: THREE.Group;
  crossLodBorderGroup: THREE.Group;
  lockedBorderOverlay: LockedBorderOverlay;
}

export interface TerrainViewSelectionGeometryStartupResult {
  selectionController: ClodSelectionController;
  updateSelection: () => void;
  cutChangedRef: { fn: () => void };
  applyNodeMesh: (node: ClodPageNode) => { geometrySwapMs: number; colliderMs: number };
  applyNodeGeometry: (node: ClodPageNode) => ClodGeometryApplyResult;
  applyNodeCollider: (node: ClodPageNode) => number;
  clodApplyQueue: ClodApplyQueue;
  drainClodApplyQueue: () => ClodApplyStatsSnapshot;
  getClodApplyStats: () => ClodApplyStatsSnapshot;
  setViewNormalMode: (view: NodeView, normalMode: PageGeometryNormalMode) => void;
}

export function runTerrainViewSelectionGeometryStartup(
  input: TerrainViewSelectionGeometryStartupInput,
): TerrainViewSelectionGeometryStartupResult {
  const {
    clodRuntime,
    cfg,
    allNodes,
    roots,
    views,
    renderNodeCache,
    pageGeometryCache,
    state,
    camera,
    renderer,
    interaction,
    player,
    terrainColliders,
    getClodErrorCompute,
    getWebGpuUnavailableReason,
    queryReadbackMode,
    queryWebGpuParity,
    poolTerrainMaterial,
    staleEditedAncestorIds,
    boundaryGroup,
    seamGroup,
    crossLodBorderGroup,
    lockedBorderOverlay,
  } = input;

  const cutChangedRef: { fn: () => void } = { fn: () => {} };
  const parentByNodeId = new Map<string, ClodPageNode>();
  for (const node of allNodes) {
    for (const child of node.children) {
      if (child) parentByNodeId.set(child.id, node);
    }
  }
  const prefetchNodes = (rendered: readonly ClodPageNode[], frameId: number): void => {
    const config = clodRuntime.renderNodeCache;
    if (!config.prefetchParent && !config.prefetchChildren) return;
    const candidates: ClodPageNode[] = [];
    const seen = new Set<string>();
    const addCandidate = (node: ClodPageNode | null | undefined) => {
      if (!node || seen.has(node.id)) return;
      seen.add(node.id);
      candidates.push(node);
    };
    for (const node of rendered) {
      if (config.prefetchParent) addCandidate(parentByNodeId.get(node.id));
      if (config.prefetchChildren) {
        for (const child of node.children) addCandidate(child);
      }
      if (candidates.length >= config.maxPrefetchCreatesPerFrame) break;
    }
    renderNodeCache.prefetch(candidates, frameId);
  };
  const selectionController = createClodSelectionController({
    config: {
      clodRuntime,
      hysteresisMergeFactor: cfg.selection.hysteresis_merge_factor,
      chunksPerPage: cfg.page.chunks_per_page,
      chunkSize: cfg.page.chunk_size,
      readbackMode: queryReadbackMode,
      forceContinuousParity: queryWebGpuParity,
      webGpuUnavailableReason: getWebGpuUnavailableReason(),
      poolTerrainMaterial,
    },
    roots,
    allNodes,
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
    getSelectionCenter: () => interaction.mode === "playing" ? player.position : camera.position,
    renderer,
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
    // Async revision-validated replacement (P2): the old collider serves (stale-safe)
    // until the off-frame rebuild installs; no MeshBVH build on this frame path.
    terrainColliders.schedulePageUpdate(node.id, node.mesh, getDigEditRevision());
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
      const p = interaction.mode === "playing" ? player.position : camera.position;
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
