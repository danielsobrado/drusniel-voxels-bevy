import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { treeGpuRingGroupIndex } from "../gpu/tree_ring_compute.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "./tree_config.js";
import type { TreeGeometryMap, TreeSpeciesGeometryMap } from "./tree_geometry.js";
import type { TreePatch } from "./tree_system_types.js";
import {
  auditTreeHeroFidelity,
  createEmptyTreeHeroFidelityStats,
  estimateTreeGpuHeroFidelity,
  treeHeroGeometryStats,
  TREE_HERO_NEAR_TRIANGLE_FLOOR,
} from "./tree_hero_fidelity.js";

describe("TREE-10 hero tree fidelity audit", () => {
  it("counts triangles and real foliage triangles from geometry", () => {
    const geometry = geometryWithFoliageMask([1, 1, 1, 0, 0, 0]);
    const stats = treeHeroGeometryStats(geometry);

    expect(stats.vertexCount).toBe(6);
    expect(stats.triangleCount).toBe(2);
    expect(stats.foliageTriangleCount).toBe(1);
    expect(stats.hasRealFoliage).toBe(true);
  });

  it("sums visible near-tree triangle counts from patch LOD state", () => {
    const geometries = geometryMap({ oak: geometryWithFoliageMask([1, 1, 1]), pine: geometryWithFoliageMask([1, 1, 1, 1, 1, 1]) });
    const patch = patchWithLods([
      { species: "oak", variant: 0, lod: "near" },
      { species: "pine", variant: 0, lod: "near" },
      { species: "oak", variant: 0, lod: "mid" },
    ]);

    const stats = auditTreeHeroFidelity({ patches: [patch], geometries, triangleFloor: 3 });

    expect(stats.nearTreeCount).toBe(2);
    expect(stats.nearTriangleCount).toBe(3);
    expect(stats.nearFoliageTriangleCount).toBe(3);
    expect(stats.minNearTreeTriangles).toBe(1);
    expect(stats.avgNearTreeTriangles).toBe(1.5);
    expect(stats.passesTriangleFloor).toBe(true);
    expect(stats.passesRealFoliage).toBe(true);
  });

  it("estimates GPU ring near-tree triangles from species group counts", () => {
    const geometries = geometryMap({ oak: geometryWithFoliageMask([1, 1, 1]), pine: geometryWithFoliageMask([1, 1, 1, 1, 1, 1]) });
    const groupCounts = new Array(TREE_SPECIES.length * TREE_LODS.length).fill(0) as number[];
    groupCounts[treeGpuRingGroupIndex("oak", "near")] = 3;
    groupCounts[treeGpuRingGroupIndex("pine", "near")] = 2;

    const stats = estimateTreeGpuHeroFidelity({ geometries, nearCount: 5, groupCounts, triangleFloor: 7 });

    expect(stats.nearTreeCount).toBe(5);
    expect(stats.nearTriangleCount).toBe(7);
    expect(stats.nearFoliageTriangleCount).toBe(7);
    expect(stats.minNearTreeTriangles).toBe(1);
    expect(stats.avgNearTreeTriangles).toBe(1.4);
    expect(stats.passesTriangleFloor).toBe(true);
    expect(stats.passesRealFoliage).toBe(true);
  });

  it("falls back to average near geometry cost when GPU group counts are unavailable", () => {
    const geometries = geometryMap({ oak: geometryWithFoliageMask([1, 1, 1]), pine: geometryWithFoliageMask([1, 1, 1, 1, 1, 1]) });

    const stats = estimateTreeGpuHeroFidelity({ geometries, nearCount: 2, groupCounts: [], triangleFloor: 1 });

    expect(stats.nearTreeCount).toBe(2);
    expect(stats.nearTriangleCount).toBeGreaterThan(0);
    expect(stats.nearFoliageTriangleCount).toBeGreaterThan(0);
    expect(stats.passesTriangleFloor).toBe(true);
  });

  it("ignores invisible patches and fails an empty hero shot", () => {
    const geometries = geometryMap({ oak: geometryWithFoliageMask([1, 1, 1]) });
    const hidden = patchWithLods([{ species: "oak", variant: 0, lod: "near" }], false);

    expect(auditTreeHeroFidelity({ patches: [hidden], geometries })).toEqual(createEmptyTreeHeroFidelityStats());
  });

  it("documents the default TREE-10 floor", () => {
    expect(TREE_HERO_NEAR_TRIANGLE_FLOOR).toBe(100_000);
  });
});

function geometryWithFoliageMask(mask: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(mask.length * 3), 3));
  geometry.setAttribute("treeFoliageMask", new THREE.Float32BufferAttribute(mask, 1));
  geometry.setIndex(Array.from({ length: mask.length }, (_, index) => index));
  return geometry;
}

function geometryMap(overrides: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>): TreeGeometryMap {
  return Object.fromEntries(TREE_SPECIES.map((species) => [species, speciesGeometryMap(overrides[species] ?? geometryWithFoliageMask([0, 0, 0]))])) as TreeGeometryMap;
}

function speciesGeometryMap(geometry: THREE.BufferGeometry): TreeSpeciesGeometryMap {
  const lods = Object.fromEntries(TREE_LODS.map((lod) => [lod, geometry])) as Record<TreeLod, THREE.BufferGeometry>;
  return {
    ...lods,
    variants: { 0: lods },
  };
}

function patchWithLods(
  rows: readonly { species: TreeSpeciesId; variant: number; lod: TreeLod | null }[],
  visible = true,
): TreePatch {
  return {
    nodeId: "test",
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    centerX: 0,
    centerZ: 0,
    radius: 1,
    instances: rows.map((row) => ({
      position: [0, 0, 0],
      species: row.species,
      variant: row.variant,
      scale: 1,
      rotationY: 0,
      normalY: 1,
    })) as TreePatch["instances"],
    group: new THREE.Group(),
    meshes: {} as TreePatch["meshes"],
    previousLods: rows.map((row) => row.lod),
    visible,
    generationStats: {
      generatedCandidates: rows.length,
      acceptedCandidates: rows.length,
      rejectedSlope: 0,
      rejectedHeight: 0,
      rejectedMaterial: 0,
      debugSamples: [],
    },
  };
}
