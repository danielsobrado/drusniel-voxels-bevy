// Shared data contracts for CLOD pages.

/** Interleaved-free SOA mesh. Positions are world-space. */
export interface PageMesh {
  positions: Float32Array; // xyz * vertexCount
  normals: Float32Array; // xyz * vertexCount
  materials: Float32Array; // paint slot per vertex: 0 = natural, slot index + 1 when painted
  indices: Uint32Array;
}

export function vertexCount(mesh: PageMesh): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: PageMesh): number {
  return mesh.indices.length / 3;
}

/** A horizontal page footprint in cell units (terrain is chunked in X/Z only). */
export interface PageFootprint {
  minX: number;
  minZ: number;
  maxX: number; // exclusive
  maxZ: number; // exclusive
}

export interface ClodPageNode {
  id: string; // e.g. "L0:0,0"
  level: number;
  children: (ClodPageNode | null)[]; // up to 4, quadtree order
  mesh: PageMesh;
  footprint: PageFootprint;
  bounds: { center: [number, number, number]; radius: number; minY: number; maxY: number };
  /** error_world = simplification_error_world + max(child.error_world). Monotone up the tree. */
  errorWorld: number;
  lowBenefit: boolean;
  /**
   * LOD0 only: the unwelded per-chunk source meshes, row-major (dz*P + dx). Cached so an
   * edit re-meshes just the chunks it touches and re-welds the page, instead of
   * re-extracting all PxP chunks. The welded page mesh stays identical to a full rebuild.
   */
  chunkMeshes?: PageMesh[];
  /** Source chunk revisions this node was built from (LOD0 only). */
  sourceRevisions?: Array<{ chunkX: number; chunkZ: number; revision: number }>;
}

export interface BorderTolerances {
  position: number; // 1e-3, matching default weld epsilon
  normalDot: number; // 0.9999
  material: number; // 1e-4
}

export const DEFAULT_TOLERANCES: BorderTolerances = {
  position: 1e-3,
  normalDot: 0.9999,
  material: 1e-4,
};

/** Hard-fail builder error - never simplify dirty input. */
export class ClodBuildError extends Error {
  constructor(public kind: string, message: string) {
    super(`${kind}: ${message}`);
    this.name = "ClodBuildError";
  }
}

/** Unique identifier for a page in the quadtree hierarchy. */
export interface PageId {
  level: number;
  x: number;
  z: number;
}

/** Bounding sphere. */
export interface BoundingSphere {
  center: Vec3;
  radius: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Terrain chunk main-surface export.
 * LOD0 only: built from same-resolution chunk terrain meshes, never from page-level voxel re-extraction.
 */
export interface TerrainChunkMainSurface {
  chunkX: number;
  chunkZ: number;
  lod: 0;
  origin: Vec3;
  revision: number;
  positions: Float32Array;
  normals: Float32Array;
  materials: Float32Array;
  indices: Uint32Array;
}
