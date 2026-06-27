// Shadow-only proxy mesh generation for the Fable-style CLOD shadow path.
//
// shadow_clod.ts selects which pages may cast; shadow_manifest.ts turns that
// decision into runtime metadata.  This module materializes ClodShadowMesh
// entries into compact geometry assets.  It deliberately avoids Three.js/Bevy
// types so the same data shape can be exported to the Rust runtime later.

import type { ClodPageNode, PageMesh } from "./types.js";
import type { ShadowManifest, ShadowManifestEntry } from "./shadow_manifest.js";

export interface ShadowMeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ShadowMesh {
  positions: Float32Array;
  indices: Uint32Array;
  bounds: ShadowMeshBounds;
  sourceTriangleCount: number;
  triangleCount: number;
  reductionRatio: number;
}

export interface ShadowMeshAsset {
  nodeId: string;
  level: number;
  shadowMeshId: string;
  visualMeshId: string;
  sourceTriangleCount: number;
  triangleCount: number;
  reductionRatio: number;
  footprint: ShadowManifestEntry["footprint"];
  bounds: ShadowMeshBounds;
  mesh: ShadowMesh;
}

export interface ShadowMeshSetTotals {
  shadowMeshCount: number;
  sourceTriangles: number;
  shadowTriangles: number;
  savedTriangles: number;
  savingsRatio: number;
}

export interface ShadowMeshSet {
  version: 1;
  generatedBy: "clod-poc-shadow-mesh";
  meshes: ShadowMeshAsset[];
  totals: ShadowMeshSetTotals;
}

export interface ShadowMeshBuildOptions {
  /** Target triangle ratio for proxy meshes before boundary preservation. */
  targetTriangleRatio?: number;
  /** Never emit fewer than this many triangles for non-empty meshes. */
  minTriangles?: number;
  /** Optional hard cap. Boundary preservation can exceed this if needed. */
  maxTriangles?: number;
  /** Preserve triangles touching the mesh X/Z bounds (not the page footprint). */
  preserveBoundary?: boolean;
  /** Boundary epsilon in world units. Auto-scales from mesh bounds when omitted. */
  borderEpsilon?: number;
}

const DEFAULT_OPTIONS: Required<Omit<ShadowMeshBuildOptions, "maxTriangles" | "borderEpsilon">> = {
  targetTriangleRatio: 0.35,
  minTriangles: 8,
  preserveBoundary: true,
};

type Bounds2D = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

function childrenOf(node: ClodPageNode): ClodPageNode[] {
  return node.children.filter((child): child is ClodPageNode => !!child);
}

function flattenRoots(roots: readonly ClodPageNode[]): ClodPageNode[] {
  const out: ClodPageNode[] = [];
  const visit = (node: ClodPageNode) => {
    out.push(node);
    for (const child of childrenOf(node)) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

export function pageMeshTriangleCount(mesh: Pick<PageMesh, "indices">): number {
  return Math.floor(mesh.indices.length / 3);
}

export function computeShadowMeshBounds(positions: Float32Array): ShadowMeshBounds {
  if (positions.length < 3) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function bounds2d(bounds: ShadowMeshBounds): Bounds2D {
  return {
    minX: bounds.min[0],
    maxX: bounds.max[0],
    minZ: bounds.min[2],
    maxZ: bounds.max[2],
  };
}

function autoBorderEpsilon(bounds: Bounds2D): number {
  const dx = Math.max(0, bounds.maxX - bounds.minX);
  const dz = Math.max(0, bounds.maxZ - bounds.minZ);
  const diagonal = Math.hypot(dx, dz);
  return Math.max(0.001, diagonal * 0.0005);
}

/**
 * Compute the target triangle count for a proxy mesh.
 *
 * `targetTriangleRatio` is a *floor*, not a reduction target: the actual count
 * is `max(minTriangles, ceil(sourceTriangles * ratio))`, clamped by
 * `maxTriangles` when provided.  On boundary-dense meshes, boundary
 * preservation pushes the output toward or even slightly above the source
 * triangle count, so reported savings can be zero or negative for tiny or
 * boundary-heavy pages.  The Bevy runtime expects this shape — do not silently
 * change savings semantics without updating the Rust consumer.
 */
function clampTargetTriangleCount(sourceTriangles: number, options: Required<Omit<ShadowMeshBuildOptions, "maxTriangles" | "borderEpsilon">> & Pick<ShadowMeshBuildOptions, "maxTriangles">): number {
  if (sourceTriangles <= 0) return 0;
  const ratioTarget = Math.ceil(sourceTriangles * options.targetTriangleRatio);
  const minTarget = Math.max(1, options.minTriangles, ratioTarget);
  const capped = options.maxTriangles == null ? minTarget : Math.min(minTarget, options.maxTriangles);
  return Math.min(sourceTriangles, Math.max(1, capped));
}

function vertexIndex(mesh: PageMesh, triangleIndex: number, corner: 0 | 1 | 2): number {
  return mesh.indices[triangleIndex * 3 + corner] ?? 0;
}

function vertexComponent(mesh: PageMesh, vertex: number, component: 0 | 1 | 2): number {
  return mesh.positions[vertex * 3 + component] ?? 0;
}

function triangleTouchesBoundary(
  mesh: PageMesh,
  triangleIndex: number,
  bounds: Bounds2D,
  epsilon: number,
): boolean {
  for (let corner = 0 as 0 | 1 | 2; corner < 3; corner = (corner + 1) as 0 | 1 | 2) {
    const vertex = vertexIndex(mesh, triangleIndex, corner);
    const x = vertexComponent(mesh, vertex, 0);
    const z = vertexComponent(mesh, vertex, 2);
    if (
      Math.abs(x - bounds.minX) <= epsilon ||
      Math.abs(x - bounds.maxX) <= epsilon ||
      Math.abs(z - bounds.minZ) <= epsilon ||
      Math.abs(z - bounds.maxZ) <= epsilon
    ) {
      return true;
    }
  }
  return false;
}

function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return [...items];
  if (count === 1) return [items[0]];

  const picked = new Set<number>();
  const step = (items.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) picked.add(Math.round(i * step));

  for (let i = 0; picked.size < count && i < items.length; i++) picked.add(i);

  return [...picked]
    .sort((a, b) => a - b)
    .map((index) => items[index]);
}

function selectTriangles(mesh: PageMesh, userOptions: ShadowMeshBuildOptions = {}): number[] {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const sourceTriangles = pageMeshTriangleCount(mesh);
  if (sourceTriangles <= 0) return [];

  const target = clampTargetTriangleCount(sourceTriangles, options);
  const allTriangles = Array.from({ length: sourceTriangles }, (_, i) => i);
  if (!options.preserveBoundary) return sampleEvenly(allTriangles, target);

  const meshBounds = bounds2d(computeShadowMeshBounds(mesh.positions));
  const epsilon = userOptions.borderEpsilon ?? autoBorderEpsilon(meshBounds);
  const boundary: number[] = [];
  const interior: number[] = [];

  for (const triangle of allTriangles) {
    if (triangleTouchesBoundary(mesh, triangle, meshBounds, epsilon)) boundary.push(triangle);
    else interior.push(triangle);
  }

  const remaining = Math.max(0, target - boundary.length);
  return [...boundary, ...sampleEvenly(interior, remaining)].sort((a, b) => a - b);
}

function compactSelectedTriangles(mesh: PageMesh, selectedTriangles: readonly number[]): Pick<ShadowMesh, "positions" | "indices"> {
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];

  const pushVertex = (originalVertex: number): number => {
    const existing = remap.get(originalVertex);
    if (existing != null) return existing;

    const next = remap.size;
    remap.set(originalVertex, next);
    positions.push(
      mesh.positions[originalVertex * 3] ?? 0,
      mesh.positions[originalVertex * 3 + 1] ?? 0,
      mesh.positions[originalVertex * 3 + 2] ?? 0,
    );
    return next;
  };

  for (const triangle of selectedTriangles) {
    indices.push(
      pushVertex(vertexIndex(mesh, triangle, 0)),
      pushVertex(vertexIndex(mesh, triangle, 1)),
      pushVertex(vertexIndex(mesh, triangle, 2)),
    );
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

export function buildShadowMeshFromPageMesh(
  mesh: PageMesh,
  userOptions: ShadowMeshBuildOptions = {},
): ShadowMesh {
  const sourceTriangleCount = pageMeshTriangleCount(mesh);
  const selectedTriangles = selectTriangles(mesh, userOptions);
  const compact = compactSelectedTriangles(mesh, selectedTriangles);
  const triangleCount = Math.floor(compact.indices.length / 3);

  return {
    positions: compact.positions,
    indices: compact.indices,
    bounds: computeShadowMeshBounds(compact.positions),
    sourceTriangleCount,
    triangleCount,
    reductionRatio: sourceTriangleCount > 0 ? triangleCount / sourceTriangleCount : 0,
  };
}

function buildNodeMap(roots: readonly ClodPageNode[]): Map<string, ClodPageNode> {
  return new Map(flattenRoots(roots).map((node) => [node.id, node]));
}

function entryNeedsShadowMesh(entry: ShadowManifestEntry): boolean {
  return entry.policy === "ClodShadowMesh" && entry.shadowMeshId != null;
}

function totals(meshes: readonly ShadowMeshAsset[]): ShadowMeshSetTotals {
  let sourceTriangles = 0;
  let shadowTriangles = 0;

  for (const asset of meshes) {
    sourceTriangles += asset.sourceTriangleCount;
    shadowTriangles += asset.triangleCount;
  }

  const savedTriangles = Math.max(0, sourceTriangles - shadowTriangles);
  return {
    shadowMeshCount: meshes.length,
    sourceTriangles,
    shadowTriangles,
    savedTriangles,
    savingsRatio: sourceTriangles > 0 ? savedTriangles / sourceTriangles : 0,
  };
}

export function buildShadowMeshSet(
  roots: readonly ClodPageNode[],
  manifest: ShadowManifest,
  userOptions: ShadowMeshBuildOptions = {},
): ShadowMeshSet {
  const nodes = buildNodeMap(roots);
  const assets: ShadowMeshAsset[] = [];

  for (const entry of manifest.entries) {
    if (!entryNeedsShadowMesh(entry)) continue;
    const node = nodes.get(entry.nodeId);
    if (!node) {
      throw new Error(`Shadow manifest references missing CLOD node: ${entry.nodeId}`);
    }
    const mesh = buildShadowMeshFromPageMesh(node.mesh, userOptions);
    assets.push({
      nodeId: entry.nodeId,
      level: entry.level,
      shadowMeshId: entry.shadowMeshId!,
      visualMeshId: entry.visualMeshId,
      sourceTriangleCount: mesh.sourceTriangleCount,
      triangleCount: mesh.triangleCount,
      reductionRatio: mesh.reductionRatio,
      footprint: { ...entry.footprint },
      bounds: mesh.bounds,
      mesh,
    });
  }

  assets.sort((a, b) => a.level - b.level || a.nodeId.localeCompare(b.nodeId));
  return {
    version: 1,
    generatedBy: "clod-poc-shadow-mesh",
    meshes: assets,
    totals: totals(assets),
  };
}

export function serializeShadowMeshSet(meshSet: ShadowMeshSet): string {
  const serializable = {
    ...meshSet,
    meshes: meshSet.meshes.map((asset) => ({
      ...asset,
      mesh: {
        ...asset.mesh,
        positions: Array.from(asset.mesh.positions),
        indices: Array.from(asset.mesh.indices),
      },
    })),
  };
  return `${JSON.stringify(serializable, null, 2)}\n`;
}
