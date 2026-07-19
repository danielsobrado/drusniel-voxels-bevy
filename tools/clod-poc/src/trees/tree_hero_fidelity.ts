import type * as THREE from "three";
import { treeGpuRingGroupIndex } from "../gpu/tree_ring_compute.js";
import { TREE_SPECIES, type TreeSpeciesId } from "./tree_config.js";
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

export interface EstimateTreeGpuHeroFidelityInput {
  geometries: TreeGeometryMap;
  nearCount: number;
  groupCounts: readonly number[];
  triangleFloor?: number;
}

type GeometryAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

interface TreeHeroGeometryCacheEntry {
  position: GeometryAttribute | undefined;
  positionVersion: number;
  positionCount: number;
  foliage: GeometryAttribute | undefined;
  foliageVersion: number;
  foliageCount: number;
  index: THREE.BufferAttribute | null;
  indexVersion: number;
  indexCount: number;
  stats: TreeHeroGeometryStats;
}

const HERO_GEOMETRY_STATS_CACHE = new WeakMap<THREE.BufferGeometry, TreeHeroGeometryCacheEntry>();

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
      addHeroGeometryStats(stats, geometryStats, 1);
      minTriangles = Math.min(minTriangles, geometryStats.triangleCount);
    }
  }

  return finalizeHeroFidelityStats(stats, minTriangles, input.triangleFloor);
}

export function estimateTreeGpuHeroFidelity(input: EstimateTreeGpuHeroFidelityInput): TreeHeroFidelityStats {
  const stats = createEmptyTreeHeroFidelityStats();
  let minTriangles = Number.POSITIVE_INFINITY;
  let countedBySpecies = 0;

  for (const species of TREE_SPECIES) {
    const count = Math.max(0, Math.floor(input.groupCounts[treeGpuRingGroupIndex(species, "near")] ?? 0));
    if (count <= 0) continue;
    const geometryStats = averageNearHeroGeometryStats(input.geometries, species);
    addHeroGeometryStats(stats, geometryStats, count);
    minTriangles = Math.min(minTriangles, geometryStats.triangleCount);
    countedBySpecies += count;
  }

  const missingCount = Math.max(0, Math.floor(input.nearCount) - countedBySpecies);
  if (missingCount > 0) {
    const fallbackStats = averageNearHeroGeometryStats(input.geometries);
    addHeroGeometryStats(stats, fallbackStats, missingCount);
    minTriangles = Math.min(minTriangles, fallbackStats.triangleCount);
  }

  return finalizeHeroFidelityStats(stats, minTriangles, input.triangleFloor);
}

export function treeHeroGeometryStats(geometry: THREE.BufferGeometry): TreeHeroGeometryStats {
  const position = geometry.getAttribute("position");
  const foliage = geometry.getAttribute("treeFoliageMask");
  const index = geometry.getIndex();
  const cached = HERO_GEOMETRY_STATS_CACHE.get(geometry);
  if (cached && geometryCacheMatches(cached, position, foliage, index)) return cached.stats;

  const triangleCount = geometryTriangleCount(geometry);
  const foliageTriangleCount = geometryFoliageTriangleCount(geometry, foliage, index, triangleCount);
  const stats = {
    vertexCount: position?.count ?? 0,
    triangleCount,
    foliageTriangleCount,
    hasRealFoliage: foliageTriangleCount > 0,
  };
  HERO_GEOMETRY_STATS_CACHE.set(geometry, createGeometryCacheEntry(position, foliage, index, stats));
  return stats;
}

function addHeroGeometryStats(stats: TreeHeroFidelityStats, geometryStats: TreeHeroGeometryStats, instanceCount: number): void {
  const count = Math.max(0, Math.floor(instanceCount));
  stats.nearTreeCount += count;
  stats.nearTriangleCount += geometryStats.triangleCount * count;
  stats.nearFoliageTriangleCount += geometryStats.foliageTriangleCount * count;
}

function finalizeHeroFidelityStats(
  stats: TreeHeroFidelityStats,
  minTriangles: number,
  triangleFloor = TREE_HERO_NEAR_TRIANGLE_FLOOR,
): TreeHeroFidelityStats {
  const floor = Math.max(0, Math.floor(triangleFloor));
  stats.minNearTreeTriangles = stats.nearTreeCount > 0 && Number.isFinite(minTriangles) ? minTriangles : 0;
  stats.avgNearTreeTriangles = stats.nearTreeCount > 0 ? stats.nearTriangleCount / stats.nearTreeCount : 0;
  stats.passesTriangleFloor = stats.nearTriangleCount >= floor;
  stats.passesRealFoliage = stats.nearTreeCount > 0 && stats.nearFoliageTriangleCount > 0;
  return stats;
}

function averageNearHeroGeometryStats(geometries: TreeGeometryMap, species?: TreeSpeciesId): TreeHeroGeometryStats {
  const speciesList = species ? [species] : TREE_SPECIES;
  let variantCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let foliageTriangleCount = 0;
  for (const candidate of speciesList) {
    const variants = geometries[candidate].variants;
    for (const variant of Object.keys(variants)) {
      const geometryStats = treeHeroGeometryStats(treeGeometryVariant(geometries, candidate, Number(variant), "near"));
      variantCount++;
      vertexCount += geometryStats.vertexCount;
      triangleCount += geometryStats.triangleCount;
      foliageTriangleCount += geometryStats.foliageTriangleCount;
    }
  }
  const divisor = Math.max(1, variantCount);
  return {
    vertexCount: vertexCount / divisor,
    triangleCount: triangleCount / divisor,
    foliageTriangleCount: foliageTriangleCount / divisor,
    hasRealFoliage: foliageTriangleCount > 0,
  };
}

function geometryCacheMatches(
  cached: TreeHeroGeometryCacheEntry,
  position: GeometryAttribute | undefined,
  foliage: GeometryAttribute | undefined,
  index: THREE.BufferAttribute | null,
): boolean {
  return cached.position === position
    && cached.positionVersion === attributeVersion(position)
    && cached.positionCount === attributeCount(position)
    && cached.foliage === foliage
    && cached.foliageVersion === attributeVersion(foliage)
    && cached.foliageCount === attributeCount(foliage)
    && cached.index === index
    && cached.indexVersion === attributeVersion(index)
    && cached.indexCount === attributeCount(index);
}

function createGeometryCacheEntry(
  position: GeometryAttribute | undefined,
  foliage: GeometryAttribute | undefined,
  index: THREE.BufferAttribute | null,
  stats: TreeHeroGeometryStats,
): TreeHeroGeometryCacheEntry {
  return {
    position,
    positionVersion: attributeVersion(position),
    positionCount: attributeCount(position),
    foliage,
    foliageVersion: attributeVersion(foliage),
    foliageCount: attributeCount(foliage),
    index,
    indexVersion: attributeVersion(index),
    indexCount: attributeCount(index),
    stats,
  };
}

function attributeVersion(attribute: GeometryAttribute | null | undefined): number {
  if (!attribute) return -1;
  if ("data" in attribute) return attribute.data.version;
  return attribute.version;
}

function attributeCount(attribute: GeometryAttribute | null | undefined): number {
  return attribute?.count ?? 0;
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  return Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
}

function geometryFoliageTriangleCount(
  geometry: THREE.BufferGeometry,
  foliage = geometry.getAttribute("treeFoliageMask"),
  index = geometry.getIndex(),
  triangleCount = geometryTriangleCount(geometry),
): number {
  if (!foliage) return 0;
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
