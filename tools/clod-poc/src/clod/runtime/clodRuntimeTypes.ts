import type { PageFootprint } from "../../types.js";
import type * as THREE from "three";

export type ClodNodeId = string;

export interface ClodBoundingSphere {
  center: [number, number, number];
  radius: number;
}

export type ClodNeighborDirection = "n" | "s" | "e" | "w";

export interface ClodPageNodeRuntime {
  id: ClodNodeId;
  level: number;
  parentId: ClodNodeId | null;
  childIds: ClodNodeId[];
  footprint: PageFootprint;
  boundingSphere: ClodBoundingSphere;
  errorWorld: number;
  minY: number;
  maxY: number;
  mesh?: THREE.Mesh | null;
  lockedBorderVertexPositions?: Float32Array;
  neighbors?: Partial<Record<ClodNeighborDirection, ClodNodeId>>;
  lowBenefit: boolean;
  ready: boolean;
}

export type ClodAcceptReason = "accepted" | "fallback" | "frozen" | "restricted-split-blocked";

export interface ClodSelectedNode {
  nodeId: ClodNodeId;
  level: number;
  errorPx: number;
  distanceToCamera: number;
  reason: ClodAcceptReason;
}

export interface ClodCut {
  frame: number;
  nodes: Map<ClodNodeId, ClodSelectedNode>;
}

export interface ClodSelectionConfig {
  errorThresholdPx: number;
  hysteresisMergeFactor: number;
  neighborLevelDeltaMax: number;
  crossfadeFrames: number;
}

export interface ClodDebugConfig {
  showWireframe: boolean;
  showPageBoundaries: boolean;
  showLockedBorderVertices: boolean;
  showErrorLabels: boolean;
  showStatsPanel: boolean;
  lodColors: Record<string, string>;
}

export interface ClodRuntimeConfig {
  selection: ClodSelectionConfig;
  debug: ClodDebugConfig;
  nearField: {
    enabled: boolean;
    radiusChunks: number;
    showMask: boolean;
  };
}

export interface ClodRuntimeStats {
  frame: number;
  selectedNodeCount: number;
  nodesPerLevel: Map<number, number>;
  trianglesRendered: number;
  errorThresholdPx: number;
  forcedRestrictedSplits: number;
  blockedRestrictedSplits: number;
  activeTransitions: number;
  crossfadeProgress: number;
  freezeEnabled: boolean;
  enforce21Enabled: boolean;
  nearFieldMaskEnabled: boolean;
}
