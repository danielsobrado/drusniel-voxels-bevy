import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createTreeMeshWriteState,
  incrementTreeMeshWriteCount,
  markTreeMeshFadeChanged,
  markTreeMeshImpostorUvChanged,
  markTreeMeshMatrixChanged,
  markTreeMeshWorldXZChanged,
  resetTreeMeshWriteState,
  resetTreeMeshWriteStateForGrid,
  treeMeshWriteCount,
  TREE_LODS,
  TREE_SPECIES,
  type TreeLod,
  type TreeSystemMeshGrid,
} from "./index.js";

describe("tree system write-state helpers", () => {
  it("creates empty write-state maps", () => {
    const write = createTreeMeshWriteState();
    expect(write.counts.size).toBe(0);
    expect(write.matrixChanged.size).toBe(0);
    expect(write.worldXZChanged.size).toBe(0);
    expect(write.impostorUvChanged.size).toBe(0);
    expect(write.fadeChanged.size).toBe(0);
  });

  it("resets and marks one mesh", () => {
    const write = createTreeMeshWriteState();
    const mesh = testMesh();

    resetTreeMeshWriteState(mesh, write);
    expect(treeMeshWriteCount(mesh, write)).toBe(0);
    expect(write.matrixChanged.get(mesh)).toBe(false);
    expect(write.worldXZChanged.get(mesh)).toBe(false);
    expect(write.impostorUvChanged.get(mesh)).toBe(false);
    expect(write.fadeChanged.get(mesh)).toBe(false);

    expect(incrementTreeMeshWriteCount(mesh, write)).toBe(1);
    expect(incrementTreeMeshWriteCount(mesh, write)).toBe(2);
    markTreeMeshMatrixChanged(mesh, write);
    markTreeMeshWorldXZChanged(mesh, write);
    markTreeMeshImpostorUvChanged(mesh, write);
    markTreeMeshFadeChanged(mesh, write);

    expect(treeMeshWriteCount(mesh, write)).toBe(2);
    expect(write.matrixChanged.get(mesh)).toBe(true);
    expect(write.worldXZChanged.get(mesh)).toBe(true);
    expect(write.impostorUvChanged.get(mesh)).toBe(true);
    expect(write.fadeChanged.get(mesh)).toBe(true);
  });

  it("resets every mesh in a tree mesh grid", () => {
    const write = createTreeMeshWriteState();
    const grid = meshGrid();
    resetTreeMeshWriteStateForGrid(grid, write);

    let count = 0;
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const mesh = grid[species][lod];
        expect(treeMeshWriteCount(mesh, write)).toBe(0);
        expect(write.matrixChanged.get(mesh)).toBe(false);
        count++;
      }
    }
    expect(count).toBe(TREE_SPECIES.length * TREE_LODS.length);
    expect(write.counts.size).toBe(count);
  });
});

function testMesh(): THREE.InstancedMesh {
  return new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
}

function meshGrid(): TreeSystemMeshGrid {
  const grid = {} as TreeSystemMeshGrid;
  for (const species of TREE_SPECIES) {
    grid[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
    for (const lod of TREE_LODS) grid[species][lod] = testMesh();
  }
  return grid;
}
