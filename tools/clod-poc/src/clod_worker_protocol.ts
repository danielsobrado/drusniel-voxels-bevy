import type { ClodPagesConfig } from "./config.js";
import type {
  BuildProgress,
  BuildResult,
  DirtyCellBounds,
  NodeBuildStat,
} from "./clod/quadtree.js";
import type { DigEdit, VoxelEditSnapshot } from "./terrain/terrain.js";
import type { BorderCoastOceanConfig } from "./terrain/border_coast_config.js";
import type { ClodPageNode, PageFootprint, PageMesh } from "./types.js";
import type { TerrainSourceInputs } from "./cache/terrainSource.js";
import type { WorkerCacheBuildStats } from "./cache/cacheMetrics.js";
import type { ClodCacheMetrics } from "./cache/cacheMetrics.js";

export interface SerializedHydrologyTerrain {
  res: number;
  worldCells: number;
  carvedBed: Float32Array;
}

export interface SerializedClodNode {
  id: string;
  level: number;
  childIds: (string | null)[];
  mesh: PageMesh;
  footprint: PageFootprint;
  bounds: { center: [number, number, number]; radius: number; minY: number; maxY: number };
  errorWorld: number;
  lowBenefit: boolean;
}

export interface SerializedBuildResult {
  roots: string[];
  nodesByLevel: [number, SerializedClodNode[]][];
  stats: NodeBuildStat[];
  worldPagesX: number;
  worldPagesZ: number;
}

export type ClodWorkerRequest =
  | {
      type: "build";
      requestId: number;
      worldPagesX: number;
      worldPagesZ: number;
      cfg: ClodPagesConfig;
      voxelEdits: VoxelEditSnapshot;
      hydrologyTerrain?: SerializedHydrologyTerrain | null;
      borderCoastOceanConfig?: BorderCoastOceanConfig | null;
      cacheDisabled?: boolean;
      digRevision?: number;
      terrainSource: TerrainSourceInputs;
    }
  | {
      type: "dig";
      requestId: number;
      edits: DigEdit[];
      dirtyRegions: DirtyCellBounds[];
    }
  | {
      type: "flush";
      requestId: number;
    }
  | {
      type: "clearCache";
      requestId: number;
    };

export interface SerializedLod0RebuildResult {
  requestIds: number[];
  editCount: number;
  changed: SerializedClodNode[];
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  serializeMs: number;
  serializedBytes: number;
  chunksRemeshed: number;
  chunksTotal: number;
  pendingParents: number;
}

export interface SerializedParentBatch {
  requestId: number | null;
  changed: SerializedClodNode[];
  parentNodes: number;
  parentMs: number;
  pendingParents: number;
}

export type ClodWorkerResponse =
  | ({ type: "progress"; requestId: number } & BuildProgress)
  | {
      type: "buildComplete";
      requestId: number;
      result: SerializedBuildResult;
      cacheBuildStats?: WorkerCacheBuildStats;
      cacheServiceMetrics?: ClodCacheMetrics;
    }
  | ({ type: "lod0Rebuilt" } & SerializedLod0RebuildResult)
  | ({ type: "parentRebuilt" } & SerializedParentBatch)
  | { type: "parentsComplete"; requestId: number | null; parentNodes: number; parentMs: number }
  | { type: "flushed"; requestId: number }
  | { type: "cacheCleared"; requestId: number }
  | { type: "error"; requestId: number | null; message: string; name?: string; code?: string; details?: Record<string, unknown> };

function cloneMesh(mesh: PageMesh): PageMesh {
  return {
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    paintSlots: mesh.paintSlots.slice(),
    materialWeights: mesh.materialWeights.slice(),
    materialWeightStride: mesh.materialWeightStride,
    indices: mesh.indices.slice(),
  };
}

function resolveChildIds(
  ownerId: string,
  childIds: readonly (string | null)[],
  nodesById: ReadonlyMap<string, ClodPageNode>,
): (ClodPageNode | null)[] {
  return childIds.map((id) => {
    if (id === null) return null;
    const child = nodesById.get(id);
    if (!child) throw new Error(`CLOD serialized node ${ownerId} references missing child ${id}`);
    return child;
  });
}

export function serializeNode(node: ClodPageNode): SerializedClodNode {
  return {
    id: node.id,
    level: node.level,
    childIds: node.children.map((child) => child?.id ?? null),
    mesh: cloneMesh(node.mesh),
    footprint: { ...node.footprint },
    bounds: { center: [...node.bounds.center], radius: node.bounds.radius, minY: node.bounds.minY, maxY: node.bounds.maxY },
    errorWorld: node.errorWorld,
    lowBenefit: node.lowBenefit,
  };
}

export function serializeNodes(nodes: readonly ClodPageNode[]): SerializedClodNode[] {
  return nodes.map(serializeNode);
}

export function collectNodeTransferables(node: SerializedClodNode, out: Transferable[]): void {
  out.push(
    node.mesh.positions.buffer,
    node.mesh.normals.buffer,
    node.mesh.paintSlots.buffer,
    node.mesh.materialWeights.buffer,
    node.mesh.indices.buffer,
  );
}

export function collectBuildResultTransferables(result: SerializedBuildResult): Transferable[] {
  const out: Transferable[] = [];
  for (const [, nodes] of result.nodesByLevel) {
    for (const node of nodes) collectNodeTransferables(node, out);
  }
  return out;
}

export function serializeBuildResult(result: BuildResult): SerializedBuildResult {
  return {
    roots: result.roots.map((node) => node.id),
    nodesByLevel: [...result.nodesByLevel.entries()].map(([level, nodes]) => [level, serializeNodes(nodes)]),
    stats: result.stats.map((stat) => ({ ...stat, polish: { ...stat.polish } })),
    worldPagesX: result.worldPagesX,
    worldPagesZ: result.worldPagesZ,
  };
}

export function indexNodes(result: BuildResult): Map<string, ClodPageNode> {
  const nodes = new Map<string, ClodPageNode>();
  for (const levelNodes of result.nodesByLevel.values()) {
    for (const node of levelNodes) nodes.set(node.id, node);
  }
  return nodes;
}

export function applySerializedNode(
  target: ClodPageNode,
  serialized: SerializedClodNode,
  nodesById: Map<string, ClodPageNode>,
): ClodPageNode {
  const children = resolveChildIds(serialized.id, serialized.childIds, nodesById);
  target.level = serialized.level;
  target.children = children;
  target.mesh = serialized.mesh;
  target.footprint = serialized.footprint;
  target.bounds = serialized.bounds;
  target.errorWorld = serialized.errorWorld;
  target.lowBenefit = serialized.lowBenefit;
  return target;
}

export function rehydrateBuildResult(serialized: SerializedBuildResult): BuildResult {
  const nodesById = new Map<string, ClodPageNode>();
  const serializedById = new Map<string, SerializedClodNode>();
  const nodesByLevel = new Map<number, ClodPageNode[]>();

  for (const [level, serializedNodes] of serialized.nodesByLevel) {
    const nodes: ClodPageNode[] = serializedNodes.map((node) => {
      if (nodesById.has(node.id)) throw new Error(`CLOD build result contains duplicate node ${node.id}`);
      const rehydrated: ClodPageNode = {
        id: node.id,
        level: node.level,
        children: [],
        mesh: node.mesh,
        footprint: node.footprint,
        bounds: node.bounds,
        errorWorld: node.errorWorld,
        lowBenefit: node.lowBenefit,
      };
      nodesById.set(rehydrated.id, rehydrated);
      serializedById.set(node.id, node);
      return rehydrated;
    });
    nodesByLevel.set(level, nodes);
  }

  for (const [, nodes] of nodesByLevel) {
    for (const node of nodes) {
      const serializedNode = serializedById.get(node.id);
      if (!serializedNode) throw new Error(`CLOD build result missing serialized node ${node.id}`);
      node.children = resolveChildIds(serializedNode.id, serializedNode.childIds, nodesById);
    }
  }

  const roots = serialized.roots.map((id) => {
    const root = nodesById.get(id);
    if (!root) throw new Error(`CLOD build result references missing root ${id}`);
    return root;
  });

  return {
    roots,
    nodesByLevel,
    stats: serialized.stats.map((stat) => ({ ...stat, polish: { ...stat.polish } })),
    worldPagesX: serialized.worldPagesX,
    worldPagesZ: serialized.worldPagesZ,
  };
}
