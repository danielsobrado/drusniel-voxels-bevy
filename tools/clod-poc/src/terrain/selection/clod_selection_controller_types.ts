import * as THREE from "three";
import type { ClodRuntimeConfig } from "../../app/runtime_config.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodErrorPxCompute, ClodErrorPxStats } from "../../gpu/clod_error_px_compute.js";
import type { WebGpuReadbackMode } from "../../core/webgpu_readback_mode.js";
import type { LockedBorderOverlay } from "../../ui/locked_border_overlay.js";
import type { SelectionCutCacheStats } from "./selection_cut_cache.js";

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
    setRootMorph(influence: number): void;
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
  getOrCreateView: (node: ClodPageNode, frameId: number) => ClodSelectionTerrainView;
  markActiveNodes?: (nodeIds: ReadonlySet<string>, frameId: number) => void;
  prefetchNodes?: (nodes: readonly ClodPageNode[], frameId: number) => void;
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
  settings: number;
  params: number;
  compute: number;
  readback: number;
  parity: number;
  lookup: number;
  cache: number;
  cut: number;
  book: number;
  views: number;
  markActive: number;
  prefetch: number;
  apply: number;
  stats: number;
  hash: number;
  commit: number;
  info: number;
  overlays: number;
  dispatch: number;
  total: number;
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
  selectionCache: SelectionCutCacheStats;
  cachedFastHits: number;
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
