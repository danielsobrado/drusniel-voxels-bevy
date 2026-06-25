import * as THREE from "three";
import type {
  ClodNodeId,
  ClodPageNodeRuntime,
  ClodCut,
  ClodSelectedNode,
  ClodSelectionConfig,
} from "./clodRuntimeTypes.js";
import { computeNodeDistanceToCamera, computeErrorPx, computeNodeErrorPx } from "./clodError.js";
import { shouldSplitNode, shouldKeepSplit } from "./clodHysteresis.js";
import { enforceRestrictedQuadtree } from "./clodRestrictedQuadtree.js";
import { logger } from "./clodLogger.js";

export interface SelectionInput {
  rootNodeIds: ClodNodeId[];
  nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>;
  previousCut: ClodCut | null;
  camera: THREE.PerspectiveCamera;
  viewportHeightPx: number;
  config: ClodSelectionConfig;
  freezeSelection: boolean;
  enforce21: boolean;
}

export function selectClodCut(input: SelectionInput): {
  cut: ClodCut;
  forcedSplits: number;
  blockedSplits: number;
} {
  const { rootNodeIds, nodes, previousCut, camera, viewportHeightPx, config, freezeSelection, enforce21 } = input;

  const fovY = THREE.MathUtils.degToRad(camera.fov);

  if (freezeSelection && previousCut) {
    const frozenNodes = new Map<ClodNodeId, ClodSelectedNode>();
    for (const [nodeId, prev] of previousCut.nodes) {
      const node = nodes.get(nodeId);
      if (!node) continue;
      const errorPx = node ? computeNodeErrorPx(node, camera, viewportHeightPx, fovY) : prev.errorPx;
      frozenNodes.set(nodeId, {
        nodeId,
        level: prev.level,
        errorPx,
        distanceToCamera: prev.distanceToCamera,
        reason: "frozen",
      });
    }
    return {
      cut: { frame: previousCut.frame + 1, nodes: frozenNodes },
      forcedSplits: 0,
      blockedSplits: 0,
    };
  }

  const newCutNodes = new Map<ClodNodeId, ClodSelectedNode>();
  const previousNodeIds = previousCut?.nodes ?? null;

  function visit(nodeId: ClodNodeId): void {
    const node = nodes.get(nodeId);
    if (!node) return;

    if (!node.ready) {
      const parentId = node.parentId;
      if (parentId && nodes.has(parentId)) {
        visit(parentId);
      }
      return;
    }

    const dist = computeNodeDistanceToCamera(node, camera);
    const errorPx = computeErrorPx({
      errorWorld: node.errorWorld,
      distanceToCamera: dist,
      viewportHeightPx,
      fovYRadians: fovY,
    });
    const wasSplit = previousNodeIds?.has(nodeId) ?? false;

    const childrenReady = node.childIds.length > 0 && node.childIds.every((cid) => {
      const child = nodes.get(cid);
      return child && child.ready;
    });

    const shouldRecurse = childrenReady && (
      wasSplit
        ? shouldKeepSplit({ wasSplit: true, errorPx, thresholdPx: config.errorThresholdPx, hysteresisMergeFactor: config.hysteresisMergeFactor })
        : shouldSplitNode({ errorPx, thresholdPx: config.errorThresholdPx })
    );

    if (shouldRecurse) {
      for (const childId of node.childIds) {
        visit(childId);
      }
    } else {
      const reason: ClodSelectedNode["reason"] = !node.childIds.every((cid) => {
        const child = nodes.get(cid);
        return child && child.ready;
      }) && node.childIds.length > 0
        ? "fallback"
        : "accepted";
      if (reason === "fallback") {
        logger.debug(`missing child fallback for ${nodeId}`);
      }
      newCutNodes.set(nodeId, {
        nodeId,
        level: node.level,
        errorPx,
        distanceToCamera: dist,
        reason,
      });
    }
  }

  for (const rootId of rootNodeIds) {
    visit(rootId);
  }

  let cut: ClodCut = { frame: (previousCut?.frame ?? 0) + 1, nodes: newCutNodes };
  let forcedSplits = 0;
  let blockedSplits = 0;

  if (enforce21) {
    const result = enforceRestrictedQuadtree({
      cut,
      nodes,
      maxLevelDelta: config.neighborLevelDeltaMax,
    });
    cut = result.cut;
    forcedSplits = result.forcedSplits;
    blockedSplits = result.blockedSplits;
  }

  return { cut, forcedSplits, blockedSplits };
}
