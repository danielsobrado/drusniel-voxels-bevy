import * as THREE from "three";
import type { ClodRuntimeConfig } from "../app/runtime_config.js";
import { LOD_COLORS } from "../app/clod_constants.js";
import {
  buildClodErrorDispatchOptions,
  createWebGpuParityTracker,
  createWebGpuReadbackState,
  resolveClodErrorGpuMap,
  verifyWebGpuClodParity,
  webGpuDispatchKey,
  type WebGpuReadbackState,
  type WebGpuParityTracker,
} from "../diagnostics/webgpu_selection_parity.js";
import type {
  ClodErrorPxCompute,
  ClodErrorPxStats,
  DispatchOptions,
} from "../gpu/clod_error_px_compute.js";
import type { WebGpuReadbackMode } from "../core/webgpu_readback_mode.js";
import { selectCut, type SelectionParams, type SelectionState } from "../selection.js";
import { LockedBorderOverlay } from "../ui/locked_border_overlay.js";
import { borderChain } from "../validate.js";
import { ClodPageNode } from "../types.js";
import {
  appendCrossLodBorderSegments,
  crossLodAdjacencies,
  hashRenderedCut,
  sharedEdge,
  type CrossLodAdjacency,
} from "./cross_lod_adjacency.js";

export interface ClodSelectionSettings {
  thresholdPx: number;
  enforce21: boolean;
  freezeSelection: boolean;
  neighborLevelDeltaMax: number;
  bubble: boolean;
  bubbleRadius: number;
  forceMaxLevel: number | "auto";
  webgpuSelection: boolean;
  showBounds: boolean;
  showSeamPoints: boolean;
  showCrossLodBorders: boolean;
  showLockedBorderVertices: boolean;
  materialTiers: boolean;
}

export interface ClodSelectionTerrainView {
  node: ClodPageNode;
  selected: boolean;
  fade: number;
  target: number;
  mesh: THREE.Mesh;
  mat: {
    setTier(tier: number): void;
    setFade(fade: number, selected: boolean, dither: boolean): void;
  };
}

export interface ClodSelectionDebugOverlays {
  boundaryGroup: THREE.Group;
  seamGroup: THREE.Group;
  crossLodBorderGroup: THREE.Group;
}

export interface ClodSelectionControllerConfig {
  clodRuntime: ClodRuntimeConfig;
  hysteresisMergeFactor: number;
  chunksPerPage: number;
  chunkSize: number;
  readbackMode: WebGpuReadbackMode;
  forceContinuousParity: boolean;
  webGpuUnavailableReason: string | null;
  poolTerrainMaterial: boolean;
}

export interface ClodSelectionControllerDeps {
  config: ClodSelectionControllerConfig;
  roots: ClodPageNode[];
  allNodes: ClodPageNode[];
  views: Map<string, ClodSelectionTerrainView>;
  getClodErrorCompute: () => ClodErrorPxCompute | null;
  getSettings: () => ClodSelectionSettings;
  getSelectionCenter: () => THREE.Vector3;
  renderer: { domElement: HTMLCanvasElement };
  camera: THREE.PerspectiveCamera;
  overlays: ClodSelectionDebugOverlays;
  lockedBorderOverlay: LockedBorderOverlay;
  staleEditedAncestorIds: Set<string>;
  onCutChanged: () => void;
}

export interface ClodSelectionSubphases {
  cut: number;
  book: number;
  info: number;
  overlays: number;
}

export interface ClodSelectionStats {
  renderedCount: number;
  renderedNodes: ClodPageNode[];
  nodesByLod: Record<number, number>;
  levelSummary: string;
  triCount: number;
  forcedSplits: number;
  nearFieldForcedSplits: number;
  crossLodAdjacencyCount: number;
  selectionMs: number;
  selectionSource: "cpu" | "webgpu";
  frameId: number;
  subphases: ClodSelectionSubphases;
}

export interface ClodSelectionController {
  update(): void;
  advanceFrame(): void;
  invalidate(): void;
  resetSelState(): void;
  stats(): ClodSelectionStats;
  currentTerrainViews(): Set<ClodSelectionTerrainView>;
  activeTerrainViews(): Set<ClodSelectionTerrainView>;
  webGpuStats(webgpuSelectionEnabled: boolean): ClodErrorPxStats;
  formatWebGpuStats(webgpuSelectionEnabled: boolean): string;
  patchNodes(nodes: readonly ClodPageNode[]): void;
}

function rebuildDebugOverlays(
  rendered: ClodPageNode[],
  xLodAdjacencies: CrossLodAdjacency[],
  settings: ClodSelectionSettings,
  overlays: ClodSelectionDebugOverlays,
): void {
  const { boundaryGroup, seamGroup, crossLodBorderGroup } = overlays;
  boundaryGroup.clear();
  if (settings.showBounds) {
    for (const n of rendered) {
      const box = new THREE.Box3(
        new THREE.Vector3(n.footprint.minX, n.bounds.center[1] - n.bounds.radius, n.footprint.minZ),
        new THREE.Vector3(n.footprint.maxX, n.bounds.center[1] + n.bounds.radius, n.footprint.maxZ),
      );
      boundaryGroup.add(new THREE.Box3Helper(box, new THREE.Color(LOD_COLORS[Math.min(n.level, 3)])));
    }
  }

  seamGroup.clear();
  if (settings.showSeamPoints) {
    const pts: number[] = [];
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        const a = rendered[i], b = rendered[j];
        if (a.level !== b.level) continue;
        const edge = sharedEdge(a, b);
        if (!edge) continue;
        const ca = borderChain(a.mesh, edge.axis, edge.aPlane, a.footprint);
        const cb = borderChain(b.mesh, edge.axis, edge.bPlane, b.footprint);
        for (const p of ca.positions) pts.push(p[0], p[1], p[2]);
        for (const p of cb.positions) pts.push(p[0], p[1], p[2]);
      }
    }
    if (pts.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = new THREE.PointsMaterial({
        color: 0xff2448,
        size: 4,
        sizeAttenuation: false,
        depthTest: false,
      });
      const pointCloud = new THREE.Points(geom, mat);
      pointCloud.renderOrder = 20;
      seamGroup.add(pointCloud);
    }
  }

  crossLodBorderGroup.clear();
  if (!settings.showCrossLodBorders) return;
  const borderPts: number[] = [];
  for (const adjacency of xLodAdjacencies) appendCrossLodBorderSegments(borderPts, adjacency);
  if (borderPts.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(borderPts), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.renderOrder = 21;
    crossLodBorderGroup.add(lines);
  }
}

export function createClodSelectionController(deps: ClodSelectionControllerDeps): ClodSelectionController {
  const { config, roots, allNodes, views, overlays, lockedBorderOverlay, staleEditedAncestorIds, onCutChanged } = deps;
  const { clodRuntime } = config;

  let selState: SelectionState = { split: new Set() };
  let lastCutHash = -1;
  let lastDebugKey = "";
  let lastForced = 0;
  let lastNearFieldForced = 0;
  let lastCrossLodAdjacencyCount = 0;
  let lastRenderedCount = 0;
  let lastRenderedNodes: ClodPageNode[] = [];
  let currentTerrainViews = new Set<ClodSelectionTerrainView>();
  const activeTerrainViews = new Set<ClodSelectionTerrainView>();
  let lastLevelSummary = "";
  let lastNodesByLod: Record<number, number> = {};
  let lastTriCount = 0;
  let selectionFrameId = 0;
  let lastSelectionMs = 0;
  const selSub: ClodSelectionSubphases = { cut: 0, book: 0, info: 0, overlays: 0 };
  let lastSelectionSource: "cpu" | "webgpu" = "cpu";
  const parityTracker: WebGpuParityTracker = createWebGpuParityTracker(
    clodRuntime.webgpuSelection.parityIntervalFrames,
  );
  let lastWebGpuDispatchFrame = -clodRuntime.webgpuSelection.dispatchIntervalFrames;
  let lastWebGpuDispatchKey = "";
  const readbackState: WebGpuReadbackState = createWebGpuReadbackState();

  const emptyWebGpuStats = (webgpuSelectionEnabled: boolean): ClodErrorPxStats => ({
    enabled: webgpuSelectionEnabled,
    available: false,
    status: webgpuSelectionEnabled ? "unavailable" : "disabled",
    reason: config.webGpuUnavailableReason ?? (webgpuSelectionEnabled ? "not initialized" : undefined),
    nodeCount: allNodes.length,
    version: 0,
    latestAgeFrames: null,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
    parity: "unchecked",
    parityMaxDelta: null,
    readbackMode: config.readbackMode,
    dispatchOnlyFrames: 0,
    readbackFrames: 0,
  });

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

    const cutIds = new Set(rendered.map((n) => n.id));
    const nextTerrainViews = new Set<ClodSelectionTerrainView>();
    for (const node of rendered) {
      const view = views.get(node.id);
      if (!view) continue;
      view.selected = true;
      if (view.target !== 1) {
        view.target = 1;
        activeTerrainViews.add(view);
      }
      nextTerrainViews.add(view);
    }
    for (const view of currentTerrainViews) {
      if (cutIds.has(view.node.id)) continue;
      view.selected = false;
      if (view.target !== 0) {
        view.target = 0;
        activeTerrainViews.add(view);
      }
    }
    currentTerrainViews = nextTerrainViews;

    if (settings.materialTiers && !config.poolTerrainMaterial) {
      for (const v of currentTerrainViews) {
        const tier = v.node.level <= 0 ? 0 : v.node.level === 1 ? 1 : 2;
        v.mat.setTier(tier);
      }
    }

    const perLevel = new Map<number, number>();
    let tris = 0;
    for (const n of rendered) {
      perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + 1);
      tris += n.mesh.indices.length / 3;
    }
    lastRenderedCount = rendered.length;
    lastRenderedNodes = rendered;
    lastNodesByLod = Object.fromEntries([...perLevel.entries()]);
    lastLevelSummary = [...perLevel.keys()].sort().map((l) => `L${l}:${perLevel.get(l)}`).join("  ");
    lastTriCount = tris;

    const tInfo = performance.now();
    selSub.book = tInfo - tSelectCut - selSub.cut;
    const cutHash = hashRenderedCut(rendered);
    if (cutHash !== lastCutHash) {
      lastCutHash = cutHash;
      onCutChanged();
    }
    selSub.info = performance.now() - tInfo;
    const tOverlays = performance.now();
    const debugKey =
      `${cutHash}|bounds:${settings.showBounds}|seams:${settings.showSeamPoints}|xlod:${settings.showCrossLodBorders}|locks:${settings.showLockedBorderVertices}`;
    if (debugKey !== lastDebugKey) {
      lastDebugKey = debugKey;
      const xLodAdjacencies = settings.showCrossLodBorders ? crossLodAdjacencies(rendered) : [];
      lastCrossLodAdjacencyCount = xLodAdjacencies.length;
      rebuildDebugOverlays(rendered, xLodAdjacencies, settings, overlays);
      lockedBorderOverlay.rebuild(rendered, settings.showLockedBorderVertices);
    }
    selSub.overlays = performance.now() - tOverlays;
    if (settings.webgpuSelection && compute) {
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
    }
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
    },
    resetSelState: () => {
      selState = { split: new Set() };
    },
    stats: () => ({
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
    }),
    currentTerrainViews: () => currentTerrainViews,
    activeTerrainViews: () => activeTerrainViews,
    webGpuStats: (webgpuSelectionEnabled) =>
      deps.getClodErrorCompute()?.stats(selectionFrameId, webgpuSelectionEnabled)
      ?? emptyWebGpuStats(webgpuSelectionEnabled),
    formatWebGpuStats: (webgpuSelectionEnabled) => {
      const stats = deps.getClodErrorCompute()?.stats(selectionFrameId, webgpuSelectionEnabled)
        ?? emptyWebGpuStats(webgpuSelectionEnabled);
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
    },
  };
}
