import type { ClodPagesConfig } from "./config.js";
import type {
  BuildProgress,
  BuildResult,
  DirtyCellBounds,
  NodeBuildStat,
} from "./clod/quadtree.js";
import type { TerrainFieldConfig, VoxelEditSnapshot, VoxelEditTransaction } from "./terrain/terrain.js";
import type { StartupHeightfieldRaster } from "./terrain/startup_heightfield_raster.js";
import type { HeightmapSource } from "./terrain/heightmap_source.js";
import type { BorderCoastOceanConfig } from "./terrain/border_coast_config.js";
import type { ClodPageNode, PageFootprint, PageMesh } from "./types.js";
import type { TerrainSourceInputs } from "./cache/terrainSource.js";
import type { FeatureTerrainStamp } from "./world/feature_stamps.js";
import type { WorkerCacheBuildStats } from "./cache/cacheMetrics.js";
import type { ClodCacheMetrics } from "./cache/cacheMetrics.js";
import type { HydrologyGraph } from "./world/hydrology_graph/hydrology_graph.js";
import type { GraphTerrainCarveConfig } from "./water/graph_hydrology.js";

export interface SerializedHydrologyTerrain {
  res: number;
  worldCells: number;
  carvedBed: Float32Array;
}

export interface SerializedSourceRevision {
  chunkX: number;
  chunkZ: number;
  revision: number;
}

export interface SerializedClodNode {
  id: string;
  revision?: number;
  sourceRevisions?: SerializedSourceRevision[];
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
      terrainFieldConfig?: TerrainFieldConfig | null;
      hydrologyTerrain?: SerializedHydrologyTerrain | null;
      /** Exact-res startup-world heightfield raster (unified mode); Float64Array clones structurally. */
      startupHeightfield?: StartupHeightfieldRaster | null;
      hydrologyGraph?: HydrologyGraph | null;
      hydrologyCarve?: GraphTerrainCarveConfig | null;
      featureStamps?: readonly FeatureTerrainStamp[];
      borderCoastOceanConfig?: BorderCoastOceanConfig | null;
      cacheDisabled?: boolean;
      digRevision?: number;
      terrainSource: TerrainSourceInputs;
      /** Imported finite-world heightmap raster; Float32Array clones structurally. */
      heightmap?: HeightmapSource | null;
    }
  | {
      type: "dig";
      requestId: number;
      transactions: VoxelEditTransaction[];
      dirtyRegions: DirtyCellBounds[];
    }
  | { type: "flush"; requestId: number }
  | { type: "clearCache"; requestId: number }
  | { type: "buildStreamRoots"; requestId: number; coords: Array<{ px: number; pz: number; level?: number }>; bypassCacheIds?: string[] };

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
  chunkPatches: SerializedLod0ChunkPatch[];
  fullPageFallbacks: number;
  pageWeldMs: number;
}

export interface SerializedLod0ChunkPatch {
  nodeId: string;
  revision: number;
  chunks: Array<{ localIndex: number; mesh: PageMesh }>;
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
  | { type: "streamRootsBuilt"; requestId: number; nodes: SerializedClodNode[]; buildMs: number; transferBytes: number; cacheStats?: WorkerCacheBuildStats }
  | { type: "error"; requestId: number | null; message: string; name?: string; code?: string; details?: Record<string, unknown> };

export function cloneMesh(mesh: PageMesh): PageMesh {
  return {
    positions: mesh.positions.slice(),
    normals: mesh.normals.slice(),
    paintSlots: mesh.paintSlots.slice(),
    materialWeights: mesh.materialWeights.slice(),
    materialWeightStride: mesh.materialWeightStride,
    indices: mesh.indices.slice(),
  };
}

function cloneSourceRevisions(revisions: readonly SerializedSourceRevision[] | undefined): SerializedSourceRevision[] | undefined {
  return revisions?.map((entry) => ({ ...entry }));
}

function serializedMetadata(node: ClodPageNode): Pick<SerializedClodNode, "revision" | "sourceRevisions"> {
  const metadata: Pick<SerializedClodNode, "revision" | "sourceRevisions"> = {};
  if (node.revision !== undefined) metadata.revision = node.revision;
  const sourceRevisions = cloneSourceRevisions(node.sourceRevisions);
  if (sourceRevisions) metadata.sourceRevisions = sourceRevisions;
  return metadata;
}

function applySerializedMetadata(target: ClodPageNode, serialized: SerializedClodNode): void {
  if (serialized.revision === undefined) delete target.revision;
  else target.revision = serialized.revision;
  const sourceRevisions = cloneSourceRevisions(serialized.sourceRevisions);
  if (sourceRevisions === undefined) delete target.sourceRevisions;
  else target.sourceRevisions = sourceRevisions;
}

function resolveChildIds(ownerId: string, childIds: readonly (string | null)[], nodesById: ReadonlyMap<string, ClodPageNode>): (ClodPageNode | null)[] {
  return childIds.map((id) => {
    if (id === null) return null;
    const child = nodesById.get(id);
    if (!child) throw new Error(`CLOD serialized node ${ownerId} references missing child ${id}`);
    return child;
  });
}

function materializeSerializedNode(node: SerializedClodNode): ClodPageNode {
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
  applySerializedMetadata(rehydrated, node);
  return rehydrated;
}

export function serializeNode(node: ClodPageNode): SerializedClodNode {
  return {
    id: node.id,
    ...serializedMetadata(node),
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
  out.push(node.mesh.positions.buffer, node.mesh.normals.buffer, node.mesh.paintSlots.buffer, node.mesh.materialWeights.buffer, node.mesh.indices.buffer);
}

export function collectBuildResultTransferables(result: SerializedBuildResult): Transferable[] {
  const out: Transferable[] = [];
  for (const [, nodes] of result.nodesByLevel) for (const node of nodes) collectNodeTransferables(node, out);
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

export function rehydrateBuildResult(result: SerializedBuildResult): BuildResult {
  const nodesById = new Map<string, ClodPageNode>();
  const nodesByLevel = new Map<number, ClodPageNode[]>();

  for (const [level, serializedNodes] of result.nodesByLevel) {
    const levelNodes: ClodPageNode[] = [];
    for (const serialized of serializedNodes) {
      if (nodesById.has(serialized.id)) throw new Error(`CLOD serialized build result contains duplicate node ${serialized.id}`);
      const node = materializeSerializedNode(serialized);
      nodesById.set(serialized.id, node);
      levelNodes.push(node);
    }
    nodesByLevel.set(level, levelNodes);
  }

  for (const [, serializedNodes] of result.nodesByLevel) {
    for (const serialized of serializedNodes) nodesById.get(serialized.id)!.children = resolveChildIds(serialized.id, serialized.childIds, nodesById);
  }

  const roots = result.roots.map((id) => {
    const root = nodesById.get(id);
    if (!root) throw new Error(`CLOD serialized build result references missing root ${id}`);
    return root;
  });

  return {
    roots,
    nodesByLevel,
    stats: result.stats.map((stat) => ({ ...stat, polish: { ...stat.polish } })),
    worldPagesX: result.worldPagesX,
    worldPagesZ: result.worldPagesZ,
  };
}

export function indexNodes(result: BuildResult): Map<string, ClodPageNode> {
  const nodes = new Map<string, ClodPageNode>();
  for (const levelNodes of result.nodesByLevel.values()) for (const node of levelNodes) nodes.set(node.id, node);
  return nodes;
}

export function applySerializedNode(target: ClodPageNode, serialized: SerializedClodNode, nodesById: Map<string, ClodPageNode>): ClodPageNode {
  const children = resolveChildIds(serialized.id, serialized.childIds, nodesById);
  applySerializedMetadata(target, serialized);
  target.level = serialized.level;
  target.children = children;
  target.mesh = serialized.mesh;
  target.footprint = serialized.footprint;
  target.bounds = serialized.bounds;
  target.errorWorld = serialized.errorWorld;
  target.lowBenefit = serialized.lowBenefit;
  return target;
}

/** Rehydrate leaf nodes that reference no children (streamed LOD0 root pages). */
export function rehydrateStandaloneNodes(nodes: readonly SerializedClodNode[]): ClodPageNode[] {
  return nodes.map((node) => {
    if (node.childIds.some((id) => id !== null)) throw new Error(`CLOD standalone node ${node.id} must not reference children`);
    return materializeSerializedNode(node);
  });
}
