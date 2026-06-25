import * as THREE from "three";
import type {
  ClodNodeId,
  ClodPageNodeRuntime,
  ClodCut,
  ClodRuntimeStats,
  ClodRuntimeConfig,
} from "./clodRuntimeTypes.js";
import { selectClodCut, type SelectionInput } from "./clodSelection.js";
import { createTransition, computeFadeStates, isTransitionComplete, type ClodTransition } from "./clodCrossfade.js";
import { createNodeMeshMap, applyFadeStates, type NodeMeshMap } from "./clodNodeVisibility.js";
import { createRuntimeStats, updateRuntimeStats } from "./clodRuntimeStats.js";
import { logger } from "./clodLogger.js";

export interface ClodRuntimeState {
  frame: number;
  previousCut: ClodCut | null;
  activeTransition: ClodTransition | null;
  nodeMeshMap: NodeMeshMap;
  stats: ClodRuntimeStats;
  nodeTriangleCounts: Map<string, number>;
  runtimeConfig: ClodRuntimeConfig;
  freezeSelection: boolean;
  enforce21: boolean;
  crossfadeEnabled: boolean;
}

export interface ClodRuntimeInput {
  rootNodeIds: ClodNodeId[];
  nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>;
  camera: THREE.PerspectiveCamera;
  viewportHeightPx: number;
}

export interface ClodRuntimeOutput {
  cut: ClodCut;
  stats: ClodRuntimeStats;
}

export function createClodRuntime(runtimeConfig: ClodRuntimeConfig): ClodRuntimeState {
  return {
    frame: 0,
    previousCut: null,
    activeTransition: null,
    nodeMeshMap: createNodeMeshMap(),
    stats: createRuntimeStats(),
    nodeTriangleCounts: new Map(),
    runtimeConfig,
    freezeSelection: false,
    enforce21: true,
    crossfadeEnabled: true,
  };
}

export function advanceClodRuntime(
  state: ClodRuntimeState,
  input: ClodRuntimeInput,
): ClodRuntimeOutput {
  const { rootNodeIds, nodes, camera, viewportHeightPx } = input;
  const { runtimeConfig } = state;
  const frame = state.frame;

  const selectionInput: SelectionInput = {
    rootNodeIds,
    nodes,
    previousCut: state.previousCut,
    camera,
    viewportHeightPx,
    config: runtimeConfig.selection,
    freezeSelection: state.freezeSelection,
    enforce21: state.enforce21,
  };

  const { cut: nextCut, forcedSplits, blockedSplits } = selectClodCut(selectionInput);

  state.stats.forcedRestrictedSplits += forcedSplits;
  state.stats.blockedRestrictedSplits += blockedSplits;
  state.stats.freezeEnabled = state.freezeSelection;
  state.stats.enforce21Enabled = state.enforce21;

  let transition: ClodTransition | null = null;
  if (state.crossfadeEnabled && runtimeConfig.selection.crossfadeFrames > 0) {
    transition = createTransition({
      previousCut: state.previousCut,
      nextCut,
      frame,
      durationFrames: runtimeConfig.selection.crossfadeFrames,
    });
    if (transition) {
      state.activeTransition = transition;
      logger.info(`cut changed at frame ${frame}: transition ${transition.id}`);
    }
  }

  if (state.activeTransition && isTransitionComplete(state.activeTransition, frame)) {
    logger.info(`transition completed: ${state.activeTransition.id}`);
    state.activeTransition = null;
  }

  const fadeStates = computeFadeStates({
    activeTransition: state.activeTransition,
    stableCut: nextCut,
    frame,
  });

  applyFadeStates(
    state.nodeMeshMap.meshes,
    state.nodeMeshMap.ditherMaterials,
    fadeStates,
    state.crossfadeEnabled && runtimeConfig.selection.crossfadeFrames > 0,
  );

  updateRuntimeStats(
    state.stats,
    nextCut,
    state.activeTransition,
    frame,
    state.nodeTriangleCounts,
  );

  state.previousCut = nextCut;
  state.frame = frame + 1;

  return { cut: nextCut, stats: state.stats };
}

export function setFreezeSelection(state: ClodRuntimeState, frozen: boolean): void {
  state.freezeSelection = frozen;
}

export function setEnforce21(state: ClodRuntimeState, enforce: boolean): void {
  state.enforce21 = enforce;
}

export function setCrossfadeEnabled(state: ClodRuntimeState, enabled: boolean): void {
  state.crossfadeEnabled = enabled;
}
