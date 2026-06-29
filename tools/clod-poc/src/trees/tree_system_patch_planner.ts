import type { ClodPageNode } from "../types.js";
import { treeFootprintCenterX, treeFootprintCenterZ, treeFootprintRadius, treeDistance2d } from "./tree_system_math.js";

export interface TreePatchDistanceInfo {
  nodeId: string;
  centerX: number;
  centerZ: number;
  radius: number;
  instances: readonly unknown[];
}

export interface TreePatchCandidate {
  node: ClodPageNode;
  distance: number;
}

export function treePatchIsInRange(
  centerX: number,
  centerZ: number,
  patchCenterX: number,
  patchCenterZ: number,
  distanceM: number,
  patchRadius: number,
): boolean {
  return treeDistance2d(centerX, centerZ, patchCenterX, patchCenterZ) <= distanceM + patchRadius;
}

export function selectRetainedTreePatches<T extends TreePatchDistanceInfo>(
  patches: readonly T[],
  centerX: number,
  centerZ: number,
  distanceM: number,
): T[] {
  return patches.filter((patch) => treePatchIsInRange(
    centerX,
    centerZ,
    patch.centerX,
    patch.centerZ,
    distanceM,
    patch.radius,
  ));
}

export function selectTreePatchCandidates(
  nodes: readonly ClodPageNode[],
  existingNodeIds: ReadonlySet<string>,
  centerX: number,
  centerZ: number,
  distanceM: number,
): TreePatchCandidate[] {
  return nodes
    .filter((node) => !existingNodeIds.has(node.id))
    .map((node) => ({
      node,
      distance: treeDistance2d(centerX, centerZ, treeFootprintCenterX(node.footprint), treeFootprintCenterZ(node.footprint)),
    }))
    .filter(({ node, distance }) => distance <= distanceM + treeFootprintRadius(node.footprint))
    .sort((a, b) => a.distance - b.distance);
}

export function countTreePatchInstances(patches: readonly TreePatchDistanceInfo[]): number {
  return patches.reduce((sum, patch) => sum + patch.instances.length, 0);
}

export function shouldDeferTreePatchRefresh(added: number, candidateCount: number): boolean {
  return added < candidateCount;
}
