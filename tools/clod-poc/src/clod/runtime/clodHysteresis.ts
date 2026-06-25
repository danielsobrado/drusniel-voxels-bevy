import type { ClodNodeId } from "./clodRuntimeTypes.js";

export function shouldSplitNode(params: {
  errorPx: number;
  thresholdPx: number;
}): boolean {
  return params.errorPx > params.thresholdPx;
}

export function shouldMergeToParent(params: {
  parentErrorPx: number;
  thresholdPx: number;
  hysteresisMergeFactor: number;
}): boolean {
  return params.parentErrorPx <= params.thresholdPx / params.hysteresisMergeFactor;
}

export function shouldKeepSplit(params: {
  wasSplit: boolean;
  errorPx: number;
  thresholdPx: number;
  hysteresisMergeFactor: number;
}): boolean {
  if (!params.wasSplit) return false;
  return params.errorPx > params.thresholdPx / params.hysteresisMergeFactor;
}

export function wasNodeSplitInPreviousCut(
  nodeId: ClodNodeId,
  previousCutNodes: Map<ClodNodeId, { nodeId: ClodNodeId; level: number }> | null,
): boolean {
  if (!previousCutNodes) return false;
  return previousCutNodes.has(nodeId);
}
