import type { ClodPageNode } from "./types.js";
import type { Lod0Snapshot, ParentNodeSnapshot, ParentQueueSnapshot } from "./clod_worker_types.js";

export function cloneBounds(bounds: ClodPageNode["bounds"]): ClodPageNode["bounds"] {
  return {
    center: [...bounds.center],
    radius: bounds.radius,
    minY: bounds.minY,
    maxY: bounds.maxY,
  };
}

export function snapshotLod0Node(node: ClodPageNode): Lod0Snapshot {
  return {
    node,
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    chunkMeshes: node.chunkMeshes ? [...node.chunkMeshes] : undefined,
    revision: node.revision,
  };
}

export function restoreLod0Nodes(snapshots: readonly Lod0Snapshot[]): void {
  for (const snapshot of snapshots) {
    snapshot.node.mesh = snapshot.mesh;
    snapshot.node.bounds = cloneBounds(snapshot.bounds);
    if (snapshot.chunkMeshes) snapshot.node.chunkMeshes = snapshot.chunkMeshes;
    else delete snapshot.node.chunkMeshes;
    if (snapshot.revision === undefined) delete snapshot.node.revision;
    else snapshot.node.revision = snapshot.revision;
  }
}

export function snapshotParentNode(node: ClodPageNode): ParentNodeSnapshot {
  return {
    node,
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    errorWorld: node.errorWorld,
    lowBenefit: node.lowBenefit,
    revision: node.revision,
  };
}

export function restoreParentNodes(snapshots: ReadonlyMap<ClodPageNode, ParentNodeSnapshot>): void {
  for (const [node, snapshot] of snapshots) {
    node.mesh = snapshot.mesh;
    node.bounds = cloneBounds(snapshot.bounds);
    node.errorWorld = snapshot.errorWorld;
    node.lowBenefit = snapshot.lowBenefit;
    if (snapshot.revision === undefined) delete node.revision;
    else node.revision = snapshot.revision;
  }
}

export function snapshotParentQueue(params: {
  pendingByLevel: Map<number, Set<string>>;
  pendingChildCoordsByLevel: Map<number, [number, number][]>;
  activeParentRequestId: number | null;
  parentNodes: number;
  parentMs: number;
}): ParentQueueSnapshot {
  const copy = new Map<number, Set<string>>();
  for (const [level, keys] of params.pendingByLevel) copy.set(level, new Set(keys));
  const childCopy = new Map<number, [number, number][]>();
  for (const [level, coords] of params.pendingChildCoordsByLevel) childCopy.set(level, coords.map((c) => [...c] as [number, number]));
  return {
    pendingByLevel: copy,
    pendingChildCoordsByLevel: childCopy,
    activeParentRequestId: params.activeParentRequestId,
    parentNodes: params.parentNodes,
    parentMs: params.parentMs,
  };
}

export function restoreParentQueue(
  snapshot: ParentQueueSnapshot,
  target: {
    pendingByLevel: Map<number, Set<string>>;
    pendingChildCoordsByLevel: Map<number, [number, number][]>;
    setActiveParentRequestId(value: number | null): void;
    setParentNodes(value: number): void;
    setParentMs(value: number): void;
  },
): void {
  target.pendingByLevel.clear();
  for (const [level, keys] of snapshot.pendingByLevel) target.pendingByLevel.set(level, new Set(keys));
  target.pendingChildCoordsByLevel.clear();
  for (const [level, coords] of snapshot.pendingChildCoordsByLevel) {
    target.pendingChildCoordsByLevel.set(level, coords.map((c) => [...c] as [number, number]));
  }
  target.setActiveParentRequestId(snapshot.activeParentRequestId);
  target.setParentNodes(snapshot.parentNodes);
  target.setParentMs(snapshot.parentMs);
}
