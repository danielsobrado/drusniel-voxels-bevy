import * as THREE from "three";
import {
  buildClodErrorDispatchOptions,
  createWebGpuParityTracker,
  createWebGpuReadbackState,
  resolveClodErrorGpuMap,
  verifyWebGpuClodParity,
  webGpuDispatchKey,
} from "../../diagnostics/webgpu_selection_parity.js";
import type {
  ClodErrorMap,
  DispatchOptions,
} from "../../gpu/clod_error_px_compute.js";
import type { ClodPageNode } from "../../types.js";
import { selectCut, type SelectionParams, type SelectionState } from "../../clod/selection.js";
import { crossLodAdjacencies, hashRenderedCut } from "../geometry/cross_lod_adjacency.js";
import {
  SelectionCutCache,
  staleSetSignature,
  type SelectionCutCacheKeyInput,
} from "./selection_cut_cache.js";
import {
  emptyWebGpuStats,
  rebuildDebugOverlays,
} from "./clod_selection_controller_defaults.js";
export { emptyWebGpuStats, rebuildDebugOverlays } from "./clod_selection_controller_defaults.js";
import type {
  ClodSelectionSettings,
  ClodSelectionTerrainView,
  ClodSelectionControllerDeps,
  ClodSelectionSubphases,
  ClodSelectionController,
} from "./clod_selection_controller_types.js";
export type {
  ClodSelectionSettings,
  ClodSelectionTerrainView,
  ClodSelectionDebugOverlays,
  ClodSelectionControllerConfig,
  ClodSelectionControllerDeps,
  ClodSelectionSubphases,
  ClodSelectionStats,
  ClodSelectionController,
} from "./clod_selection_controller_types.js";

export function createClodSelectionController(deps: ClodSelectionControllerDeps): ClodSelectionController {
  const { config, roots, allNodes, overlays, lockedBorderOverlay, staleEditedAncestorIds, onCutChanged } = deps;
  const { clodRuntime } = config;

  let selState: SelectionState = { split: new Set() };
  let lastCutHash = -1;
  let lastDebugKey = "";
  let lastForced = 0;
  let lastNearFieldForced = 0;
  let lastCrossLodAdjacencyCount = 0;
  let lastRenderedCount = 0;
  let lastRenderedNodes: ClodPageNode[] = [];
  let lastRenderedNodeIds = new Set<string>();
  let currentTerrainViews = new Set<ClodSelectionTerrainView>();
  const activeTerrainViews = new Set<ClodSelectionTerrainView>();
  let lastLevelSummary = "";
  let lastNodesByLod: Record<number, number> = {};
  let lastTriCount = 0;
  let selectionFrameId = 0;
  let lastSelectionMs = 0;
  let cachedFastHits = 0;
  const selSub: ClodSelectionSubphases = { cut: 0, book: 0, info: 0, overlays: 0 };
  let lastSelectionSource: "cpu" | "webgpu" = "cpu";
  const parityTracker = createWebGpuParityTracker(
    clodRuntime.webgpuSelection.parityIntervalFrames,
  );
  let lastWebGpuDispatchFrame = -clodRuntime.webgpuSelection.dispatchIntervalFrames;
  let lastWebGpuDispatchKey = "";
  const readbackState = createWebGpuReadbackState();
  const selectionCutCache = new SelectionCutCache(clodRuntime.selectionCutCache);
  const cameraForward = new THREE.Vector3();
  let lastStaleSignature = staleSetSignature(staleEditedAncestorIds);
  let staleRevision = 0;

  const buildSelectionParams = (settings: ClodSelectionSettings): SelectionParams => {
    const selectionCenter = deps.getSelectionCenter();
    return {
      thresholdPx: settings.thresholdPx,
      hysteresisMergeFactor: config.hysteresisMergeFactor,
      enforce21: settings.enforce21,
      freezeSelection: settings.freezeSelection,
      neighborLevelDeltaMax: settings.neighborLevelDeltaMax,
      nearField: {
        enabled: settings.bubble,
        centerX: selectionCenter.x,
        centerZ: selectionCenter.z,
        radius: settings.bubbleRadius,
        boundaryPadding: config.chunksPerPage * config.chunkSize,
      },
      viewportH: deps.renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(deps.camera.fov),
      camPos: [deps.camera.position.x, deps.camera.position.y, deps.camera.position.z],
      forcedMaxLevel: settings.forceMaxLevel === "auto" ? null : Number(settings.forceMaxLevel),
    };
  };

  const currentStaleRevision = (): number => {
    const signature = staleSetSignature(staleEditedAncestorIds);
    if (signature !== lastStaleSignature) {
      lastStaleSignature = signature;
      staleRevision++;
      selectionCutCache.invalidate("stale_revision_changed");
    }
    return staleRevision;
  };

  const buildDebugKey = (cutHash: number, settings: ClodSelectionSettings): string =>
    `${cutHash}|bounds:${settings.showBounds}|seams:${settings.showSeamPoints}|xlod:${settings.showCrossLodBorders}|locks:${settings.showLockedBorderVertices}`;

  const buildCacheInput = (
    settings: ClodSelectionSettings,
    params: SelectionParams,
    gpuMap: ClodErrorMap | null,
    debugKey: string,
  ): SelectionCutCacheKeyInput => {
    deps.camera.getWorldDirection(cameraForward);
    return {
      frameId: selectionFrameId,
      cameraPosition: params.camPos,
      cameraForward: [cameraForward.x, cameraForward.y, cameraForward.z],
      selectionCenter: [
        params.nearField?.centerX ?? params.camPos[0],
        0,
        params.nearField?.centerZ ?? params.camPos[2],
      ],
      viewportHeight: params.viewportH,
      fovY: params.fovY,
      thresholdPx: params.thresholdPx,
      hysteresisMergeFactor: params.hysteresisMergeFactor,
      enforce21: params.enforce21,
      freezeSelection: params.freezeSelection ?? false,
      neighborLevelDeltaMax: params.neighborLevelDeltaMax ?? 1,
      materialTiers: settings.materialTiers,
      bubbleEnabled: params.nearField?.enabled ?? false,
      bubbleCenterX: params.nearField?.centerX ?? 0,
      bubbleCenterZ: params.nearField?.centerZ ?? 0,
      bubbleRadius: params.nearField?.radius ?? 0,
      forcedMaxLevel: params.forcedMaxLevel ?? null,
      webgpuSelectionEnabled: settings.webgpuSelection,
      webgpuErrorMapGeneration: gpuMap ? `${gpuMap.version}:${gpuMap.frameId}` : null,
      staleRevision: currentStaleRevision(),
      debugKey,
    };
  };

  const applyMaterialTier = (view: ClodSelectionTerrainView, settings: ClodSelectionSettings): void => {
    if (!settings.materialTiers || config.poolTerrainMaterial) return;
    const tier = view.node.level <= 0 ? 0 : view.node.level === 1 ? 1 : 2;
    view.mat.setTier(tier);
  };

  const applyRenderedCut = (rendered: ClodPageNode[], settings: ClodSelectionSettings): void => {
    const cutIds = new Set(rendered.map((n) => n.id));
    const nextTerrainViews = new Set<ClodSelectionTerrainView>();
    for (const node of rendered) {
      const view = deps.getOrCreateView(node, selectionFrameId);
      view.selected = true;
      if (view.target !== 1) {
        view.target = 1;
        activeTerrainViews.add(view);
      }
      applyMaterialTier(view, settings);
      nextTerrainViews.add(view);
    }
    deps.markActiveNodes?.(cutIds, selectionFrameId);
    deps.prefetchNodes?.(rendered, selectionFrameId);
    for (const view of currentTerrainViews) {
      if (cutIds.has(view.node.id)) continue;
      view.selected = false;
      if (view.target !== 0) {
        view.target = 0;
        activeTerrainViews.add(view);
      }
    }
    currentTerrainViews = nextTerrainViews;
  };

  const updateRenderedStats = (rendered: ClodPageNode[]): void => {
    const perLevel = new Map<number, number>();
    let tris = 0;
    for (const n of rendered) {
      perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + 1);
      tris += n.mesh.indices.length / 3;
    }
    lastRenderedCount = rendered.length;
    lastRenderedNodes = rendered;
    lastRenderedNodeIds = new Set(rendered.map((n) => n.id));
    lastNodesByLod = Object.fromEntries([...perLevel.entries()]);
    lastLevelSummary = [...perLevel.keys()].sort().map((l) => `L${l}:${perLevel.get(l)}`).join("  ");
    lastTriCount = tris;
  };

  const maybeRebuildDebugOverlays = (
    rendered: ClodPageNode[],
    cutHash: number,
    settings: ClodSelectionSettings,
  ): void => {
    const debugKey = buildDebugKey(cutHash, settings);
    if (debugKey === lastDebugKey) return;
    lastDebugKey = debugKey;
    const xLodAdjacencies = settings.showCrossLodBorders ? crossLodAdjacencies(rendered) : [];
    lastCrossLodAdjacencyCount = xLodAdjacencies.length;
    rebuildDebugOverlays(rendered, xLodAdjacencies, settings, overlays);
    lockedBorderOverlay.rebuild(rendered, settings.showLockedBorderVertices);
  };

  const maybeDispatchWebGpuSelection = (
    settings: ClodSelectionSettings,
    params: SelectionParams,
    compute: ReturnType<ClodSelectionControllerDeps["getClodErrorCompute"]>,
    gpuMap: ClodErrorMap | null,
  ): void => {
    if (!settings.webgpuSelection || !compute) return;
    const dispatchKey = webGpuDispatchKey(params);
    const dispatchDue =
      selectionFrameId - lastWebGpuDispatchFrame >= clodRuntime.webgpuSelection.dispatchIntervalFrames;
    if (dispatchDue && (!gpuMap || dispatchKey !== lastWebGpuDispatchKey)) {
      const dispatchOptions: DispatchOptions = buildClodErrorDispatchOptions({
        readbackMode: config.readbackMode,
        compute,
        readbackState,
      });
      if (compute.dispatch(params, selectionFrameId, dispatchOptions)) {
        lastWebGpuDispatchFrame = selectionFrameId;
        lastWebGpuDispatchKey = dispatchKey;
      }
    }
  };

  const update = () => {
    const settings = deps.getSettings();
    const selectionStart = performance.now();
    const params = buildSelectionParams(settings);
    const compute = deps.getClodErrorCompute();
    const gpuMap = resolveClodErrorGpuMap({
      enabled: settings.webgpuSelection,
      compute,
      selectionFrameId,
      errorMaxAgeFrames: clodRuntime.webgpuSelection.errorMaxAgeFrames,
      readbackMode: config.readbackMode,
      readbackState,
    });
    if (gpuMap && compute) {
      verifyWebGpuClodParity({
        map: gpuMap,
        params,
        allNodes,
        compute,
        selectionFrameId,
        tracker: parityTracker,
        parityIntervalFrames: clodRuntime.webgpuSelection.parityIntervalFrames,
        errorTolerancePx: clodRuntime.webgpuSelection.errorTolerancePx,
        forceContinuous: config.forceContinuousParity,
      });
    }
    const errorPxLookup = gpuMap && compute ? compute.errorLookup(gpuMap) : undefined;
    const staleViewsMissing = lastRenderedNodes.length > 0 && lastRenderedNodes.some((node) => !deps.views.has(node.id));
    if (staleViewsMissing) selectionCutCache.invalidate("forced_invalidate");
    const initialDebugKey = buildDebugKey(lastCutHash, settings);
    const initialCacheInput = buildCacheInput(settings, params, gpuMap, initialDebugKey);
    const cacheDecision = selectionCutCache.decide(initialCacheInput);
    if (cacheDecision.hit && lastRenderedNodes.length > 0) {
      const tBook = performance.now();
      deps.markActiveNodes?.(lastRenderedNodeIds, selectionFrameId);
      cachedFastHits++;
      selSub.book = performance.now() - tBook;
      lastSelectionSource = errorPxLookup ? "webgpu" : "cpu";
      selSub.cut = 0;
      selSub.info = 0;
      const tOverlays = performance.now();
      maybeRebuildDebugOverlays(lastRenderedNodes, lastCutHash, settings);
      selSub.overlays = performance.now() - tOverlays;
      maybeDispatchWebGpuSelection(settings, params, compute, gpuMap);
      lastSelectionMs = performance.now() - selectionStart;
      return;
    }

    const tSelectCut = performance.now();
    const { rendered, state: ns, forcedSplits, nearFieldForcedSplits } = selectCut(
      roots,
      params,
      selState,
      { errorPxLookup, forceSplitIds: staleEditedAncestorIds },
    );
    selSub.cut = performance.now() - tSelectCut;
    selState = ns;
    lastForced = forcedSplits;
    lastNearFieldForced = nearFieldForcedSplits;
    lastSelectionSource = errorPxLookup ? "webgpu" : "cpu";

    applyRenderedCut(rendered, settings);
    updateRenderedStats(rendered);

    const tInfo = performance.now();
    selSub.book = tInfo - tSelectCut - selSub.cut;
    const cutHash = hashRenderedCut(rendered);
    if (cutHash !== lastCutHash) {
      lastCutHash = cutHash;
      onCutChanged();
    }
    selectionCutCache.commit({ ...initialCacheInput, debugKey: buildDebugKey(cutHash, settings) }, selectionFrameId);
    selSub.info = performance.now() - tInfo;
    const tOverlays = performance.now();
    maybeRebuildDebugOverlays(rendered, cutHash, settings);
    selSub.overlays = performance.now() - tOverlays;
    maybeDispatchWebGpuSelection(settings, params, compute, gpuMap);
    lastSelectionMs = performance.now() - selectionStart;
  };

  return {
    update,
    advanceFrame: () => {
      selectionFrameId++;
    },
    invalidate: () => {
      lastCutHash = -1;
      lastDebugKey = "";
      selectionCutCache.invalidate("forced_invalidate");
    },
    resetSelState: () => {
      selState = { split: new Set() };
      selectionCutCache.invalidate("forced_invalidate");
    },
    stats: () => {
      const selectionCache = selectionCutCache.stats();
      return {
        renderedCount: lastRenderedCount,
        renderedNodes: lastRenderedNodes,
        nodesByLod: lastNodesByLod,
        levelSummary: lastLevelSummary,
        triCount: lastTriCount,
        forcedSplits: lastForced,
        nearFieldForcedSplits: lastNearFieldForced,
        crossLodAdjacencyCount: lastCrossLodAdjacencyCount,
        selectionMs: lastSelectionMs,
        selectionSource: lastSelectionSource,
        frameId: selectionFrameId,
        subphases: { ...selSub },
        selectionCache,
        cachedFastHits,
      };
    },
    currentTerrainViews: () => currentTerrainViews,
    activeTerrainViews: () => activeTerrainViews,
    webGpuStats: (webgpuSelectionEnabled) =>
      deps.getClodErrorCompute()?.stats(selectionFrameId, webgpuSelectionEnabled)
      ?? emptyWebGpuStats(webgpuSelectionEnabled, allNodes.length, config.webGpuUnavailableReason, config.readbackMode),
    formatWebGpuStats: (webgpuSelectionEnabled) => {
      const stats = deps.getClodErrorCompute()?.stats(selectionFrameId, webgpuSelectionEnabled)
        ?? emptyWebGpuStats(webgpuSelectionEnabled, allNodes.length, config.webGpuUnavailableReason, config.readbackMode);
      if (!webgpuSelectionEnabled) return "webgpu=off";
      if (!stats.available) return `webgpu=${stats.status}${stats.reason ? ` (${stats.reason})` : ""}`;
      const age = stats.latestAgeFrames === null ? "none" : `${stats.latestAgeFrames}f`;
      const dispatch = stats.submitMs === null ? "-" : `${stats.submitMs.toFixed(2)}ms`;
      const readback = stats.readbackMs === null ? "-" : `${stats.readbackMs.toFixed(2)}ms`;
      const parityDelta = stats.parityMaxDelta === null ? "" : ` d=${stats.parityMaxDelta.toFixed(4)}px`;
      return `webgpu=${stats.status} rb=${stats.readbackMode} age=${age} dispatch=${dispatch} read=${readback} parity=${stats.parity}${parityDelta} dOnly=${stats.dispatchOnlyFrames}`;
    },
    patchNodes: (nodes) => {
      deps.getClodErrorCompute()?.patchNodes(nodes);
      if (nodes.length > 0) selectionCutCache.invalidate("forced_invalidate");
    },
  };
}
