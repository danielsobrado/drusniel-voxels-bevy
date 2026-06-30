import type * as THREE from "three";
import { treeGeometryVariant, type TreeGeometryMap } from "./tree_geometry.js";
import type { TreePatch } from "./tree_system_types.js";

export const TREE_HERO_NEAR_TRIANGLE_FLOOR = 100_000;

export interface TreeHeroGeometryStats {
  vertexCount: number;
  triangleCount: number;
  foliageTriangleCount: number;
  hasRealFoliage: boolean;
}

export interface TreeHeroFidelityStats {
  nearTreeCount: number;
  nearTriangleCount: number;
  nearFoliageTriangleCount: number;
  minNearTreeTriangles: number;
  avgNearTreeTriangles: number;
  passesTriangleFloor: boolean;
  passesRealFoliage: boolean;
}

export interface AuditTreeHeroFidelityInput {
  patches: readonly TreePatch[];
  geometries: TreeGeometryMap;
  triangleFloor?: number;
}

export function createEmptyTreeHeroFidelityStats(): TreeHeroFidelityStats {
  return {
    nearTreeCount: 0,
    nearTriangleCount: 0,
    nearFoliageTriangleCount: 0,
    minNearTreeTriangles: 0,
    avgNearTreeTriangles: 0,
    passesTriangleFloor: false,
    passesRealFoliage: false,
  };
}

export function auditTreeHeroFidelity(input: AuditTreeHeroFidelityInput): TreeHeroFidelityStats {
  const triangleFloor = Math.max(0, Math.floor(input.triangleFloor ?? TREE_HERO_NEAR_TRIANGLE_FLOOR));
  const stats = createEmptyTreeHeroFidelityStats();
  let minTriangles = Number.POSITIVE_INFINITY;

  for (const patch of input.patches) {
    if (!patch.visible) continue;
    for (let i = 0; i < patch.instances.length; i++) {
      if (patch.previousLods[i] !== "near") continue;
      const instance = patch.instances[i];
      if (!instance) continue;
      const geometry = treeGeometryVariant(input.geometries, instance.species, instance.variant, "near");
      const geometryStats = treeHeroGeometryStats(geometry);
      stats.nearTreeCount++;
      stats.nearTriangleCount += geometryStats.triangleCount;
      stats.nearFoliageTriangleCount += geometryStats.foliageTriangleCount;
      minTriangles = Math.min(minTriangles, geometryStats.triangleCount);
    }
  }

  stats.minNearTreeTriangles = stats.nearTreeCount > 0 && Number.isFinite(minTriangles) ? minTriangles : 0;
  stats.avgNearTreeTriangles = stats.nearTreeCount > 0 ? stats.nearTriangleCount / stats.nearTreeCount : 0;
  stats.passesTriangleFloor = stats.nearTriangleCount >= triangleFloor;
  stats.passesRealFoliage = stats.nearTreeCount > 0 && stats.nearFoliageTriangleCount > 0;
  return stats;
}

export function treeHeroGeometryStats(geometry: THREE.BufferGeometry): TreeHeroGeometryStats {
  const vertexCount = geometry.getAttribute("position")?.count ?? 0;
  const triangleCount = geometryTriangleCount(geometry);
  const foliageTriangleCount = geometryFoliageTriangleCount(geometry);
  return {
    vertexCount,
    triangleCount,
    foliageTriangleCount,
    hasRealFoliage: foliageTriangleCount > 0,
  };
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  return Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
}

function geometryFoliageTriangleCount(geometry: THREE.BufferGeometry): number {
  const foliage = geometry.getAttribute("treeFoliageMask");
  if (!foliage) return 0;
  const index = geometry.getIndex();
  const triangleCount = geometryTriangleCount(geometry);
  let count = 0;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = vertexIndex(index, triangle * 3);
    const b = vertexIndex(index, triangle * 3 + 1);
    const c = vertexIndex(index, triangle * 3 + 2);
    if ((foliage.getX(a) > 0.5) || (foliage.getX(b) > 0.5) || (foliage.getX(c) > 0.5)) count++;
  }
  return count;
}

function vertexIndex(index: THREE.BufferAttribute | null, offset: number): number {
  return index ? index.getX(offset) : offset;
}
