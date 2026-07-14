import type { PageMesh } from "../../types.js";

const INVALID_INDEX = 0xffff_ffff;
const MESHLET_HEADER_WORDS = 8;
const HIERARCHY_HEADER_WORDS = 4;
const BOUNDS_WORDS = 4;

export interface GpuClodMeshletOptions {
  maxVertices: number;
  maxTriangles: number;
  hierarchyFanout?: number;
}

export interface GpuClodMeshletHierarchy {
  meshletHeaders: Uint32Array;
  vertexIndices: Uint32Array;
  triangleIndices: Uint32Array;
  hierarchyHeaders: Uint32Array;
  bounds: Float32Array;
  meshletCount: number;
  hierarchyNodeCount: number;
}

interface MutableMeshlet {
  vertices: number[];
  triangles: number[];
}

interface Sphere {
  x: number;
  y: number;
  z: number;
  radius: number;
}

interface HierarchyNode {
  firstChild: number;
  childCount: number;
  parent: number;
  level: number;
  bounds: Sphere;
}

export function buildGpuClodMeshletHierarchy(
  mesh: PageMesh,
  options: GpuClodMeshletOptions,
): GpuClodMeshletHierarchy {
  const maxVertices = boundedPositive(options.maxVertices, 64, 3);
  const maxTriangles = boundedPositive(options.maxTriangles, 64, 1);
  const fanout = boundedPositive(options.hierarchyFanout ?? 4, 4, 2);
  if (mesh.indices.length % 3 !== 0) throw new Error("CLOD meshlet source index count must be divisible by three");

  const meshlets = partitionMeshlets(mesh, maxVertices, maxTriangles);
  const vertexIndices: number[] = [];
  const triangleIndices: number[] = [];
  const leafBounds: Sphere[] = [];
  const meshletHeaders = new Uint32Array(meshlets.length * MESHLET_HEADER_WORDS);

  for (let meshletIndex = 0; meshletIndex < meshlets.length; meshletIndex++) {
    const meshlet = meshlets[meshletIndex]!;
    const vertexOffset = vertexIndices.length;
    const triangleOffset = triangleIndices.length;
    vertexIndices.push(...meshlet.vertices);
    triangleIndices.push(...meshlet.triangles);
    leafBounds.push(boundsForVertices(mesh.positions, meshlet.vertices));
    const base = meshletIndex * MESHLET_HEADER_WORDS;
    meshletHeaders[base] = vertexOffset;
    meshletHeaders[base + 1] = meshlet.vertices.length;
    meshletHeaders[base + 2] = triangleOffset;
    meshletHeaders[base + 3] = meshlet.triangles.length / 3;
    meshletHeaders[base + 4] = INVALID_INDEX;
    meshletHeaders[base + 5] = meshletIndex;
    meshletHeaders[base + 6] = 0;
    meshletHeaders[base + 7] = 0;
  }

  const hierarchy = buildHierarchy(leafBounds, fanout);
  for (let meshletIndex = 0; meshletIndex < meshlets.length; meshletIndex++) {
    meshletHeaders[meshletIndex * MESHLET_HEADER_WORDS + 4] = hierarchy.nodes[meshletIndex]?.parent ?? INVALID_INDEX;
  }

  return {
    meshletHeaders,
    vertexIndices: Uint32Array.from(vertexIndices),
    triangleIndices: Uint32Array.from(triangleIndices),
    hierarchyHeaders: packHierarchyHeaders(hierarchy.nodes),
    bounds: packBounds(hierarchy.nodes),
    meshletCount: meshlets.length,
    hierarchyNodeCount: hierarchy.nodes.length,
  };
}

function partitionMeshlets(mesh: PageMesh, maxVertices: number, maxTriangles: number): MutableMeshlet[] {
  const meshlets: MutableMeshlet[] = [];
  let current = emptyMeshlet();
  let localByGlobal = new Map<number, number>();

  const flush = (): void => {
    if (current.triangles.length === 0) return;
    meshlets.push(current);
    current = emptyMeshlet();
    localByGlobal = new Map<number, number>();
  };

  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = [mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!] as const;
    validateTriangle(mesh, triangle, offset / 3);
    const uniqueNew = triangle.reduce((count, vertex) => count + (localByGlobal.has(vertex) ? 0 : 1), 0);
    const triangleCount = current.triangles.length / 3;
    if (triangleCount > 0 && (triangleCount + 1 > maxTriangles || current.vertices.length + uniqueNew > maxVertices)) flush();

    for (const globalVertex of triangle) {
      let localVertex = localByGlobal.get(globalVertex);
      if (localVertex === undefined) {
        localVertex = current.vertices.length;
        current.vertices.push(globalVertex);
        localByGlobal.set(globalVertex, localVertex);
      }
      current.triangles.push(localVertex);
    }
  }
  flush();
  return meshlets;
}

function buildHierarchy(leafBounds: readonly Sphere[], fanout: number): { nodes: HierarchyNode[] } {
  const nodes: HierarchyNode[] = leafBounds.map((bounds) => ({
    firstChild: INVALID_INDEX,
    childCount: 0,
    parent: INVALID_INDEX,
    level: 0,
    bounds,
  }));
  let levelStart = 0;
  let levelCount = leafBounds.length;
  let level = 1;

  while (levelCount > 1) {
    const parentStart = nodes.length;
    for (let offset = 0; offset < levelCount; offset += fanout) {
      const childCount = Math.min(fanout, levelCount - offset);
      const firstChild = levelStart + offset;
      const parentIndex = nodes.length;
      const childBounds: Sphere[] = [];
      for (let childOffset = 0; childOffset < childCount; childOffset++) {
        const child = nodes[firstChild + childOffset]!;
        child.parent = parentIndex;
        childBounds.push(child.bounds);
      }
      nodes.push({
        firstChild,
        childCount,
        parent: INVALID_INDEX,
        level,
        bounds: unionSpheres(childBounds),
      });
    }
    levelStart = parentStart;
    levelCount = nodes.length - parentStart;
    level++;
  }
  return { nodes };
}

function packHierarchyHeaders(nodes: readonly HierarchyNode[]): Uint32Array {
  const packed = new Uint32Array(nodes.length * HIERARCHY_HEADER_WORDS);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const base = index * HIERARCHY_HEADER_WORDS;
    packed[base] = node.firstChild;
    packed[base + 1] = node.childCount;
    packed[base + 2] = node.parent;
    packed[base + 3] = node.level;
  }
  return packed;
}

function packBounds(nodes: readonly HierarchyNode[]): Float32Array {
  const packed = new Float32Array(nodes.length * BOUNDS_WORDS);
  for (let index = 0; index < nodes.length; index++) {
    const bounds = nodes[index]!.bounds;
    const base = index * BOUNDS_WORDS;
    packed[base] = bounds.x;
    packed[base + 1] = bounds.y;
    packed[base + 2] = bounds.z;
    packed[base + 3] = bounds.radius;
  }
  return packed;
}

function boundsForVertices(positions: Float32Array, vertices: readonly number[]): Sphere {
  if (vertices.length === 0) return { x: 0, y: 0, z: 0, radius: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of vertices) {
    const base = vertex * 3;
    const x = positions[base]!;
    const y = positions[base + 1]!;
    const z = positions[base + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const x = (minX + maxX) * 0.5;
  const y = (minY + maxY) * 0.5;
  const z = (minZ + maxZ) * 0.5;
  let radiusSq = 0;
  for (const vertex of vertices) {
    const base = vertex * 3;
    const dx = positions[base]! - x;
    const dy = positions[base + 1]! - y;
    const dz = positions[base + 2]! - z;
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  return { x, y, z, radius: Math.sqrt(radiusSq) };
}

function unionSpheres(spheres: readonly Sphere[]): Sphere {
  if (spheres.length === 0) return { x: 0, y: 0, z: 0, radius: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const sphere of spheres) {
    minX = Math.min(minX, sphere.x - sphere.radius);
    minY = Math.min(minY, sphere.y - sphere.radius);
    minZ = Math.min(minZ, sphere.z - sphere.radius);
    maxX = Math.max(maxX, sphere.x + sphere.radius);
    maxY = Math.max(maxY, sphere.y + sphere.radius);
    maxZ = Math.max(maxZ, sphere.z + sphere.radius);
  }
  const x = (minX + maxX) * 0.5;
  const y = (minY + maxY) * 0.5;
  const z = (minZ + maxZ) * 0.5;
  let radius = 0;
  for (const sphere of spheres) {
    radius = Math.max(radius, Math.hypot(sphere.x - x, sphere.y - y, sphere.z - z) + sphere.radius);
  }
  return { x, y, z, radius };
}

function validateTriangle(mesh: PageMesh, triangle: readonly [number, number, number], triangleIndex: number): void {
  const vertexCount = mesh.positions.length / 3;
  for (const vertex of triangle) {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      throw new Error(`CLOD meshlet triangle ${triangleIndex} references invalid vertex ${vertex}/${vertexCount}`);
    }
  }
}

function emptyMeshlet(): MutableMeshlet {
  return { vertices: [], triangles: [] };
}

function boundedPositive(value: number, fallback: number, minimum: number): number {
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}
