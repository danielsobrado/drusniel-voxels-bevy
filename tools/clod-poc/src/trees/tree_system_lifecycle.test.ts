import { describe, expect, it, vi, type MockInstance } from "vitest";
import * as THREE from "three";
import {
  disposeMaterial,
  disposeTreeMaterialHandles,
  disposeTreeMeshGrid,
  removeAndDisposeObjects,
  removeTreePatchResources,
  TREE_LODS,
  TREE_SPECIES,
  type TreeLod,
  type TreeMaterialHandle,
  type TreeSpeciesId,
  type TreeSystemMeshGrid,
} from "./index.js";

describe("tree system lifecycle helpers", () => {
  it("disposes single and array materials", () => {
    const a = new THREE.MeshBasicMaterial();
    const b = new THREE.MeshBasicMaterial();
    const disposeA = vi.spyOn(a, "dispose");
    const disposeB = vi.spyOn(b, "dispose");

    disposeMaterial(a);
    disposeMaterial([b]);

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
  });

  it("disposes material handles", () => {
    const first = fakeHandle();
    const second = fakeHandle();
    disposeTreeMaterialHandles([first, second]);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes patch-owned mesh resources but preserves shared materials", () => {
    const grid = meshGrid();
    const disposals = spyGridDisposals(grid);

    disposeTreeMeshGrid(grid);

    for (const dispose of disposals.geometryAndMesh) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of disposals.materials) expect(dispose).not.toHaveBeenCalled();
  });

  it("removes a patch group without disposing shared materials", () => {
    const root = new THREE.Group();
    const group = new THREE.Group();
    root.add(group);
    const grid = meshGrid();
    const disposals = spyGridDisposals(grid);

    removeTreePatchResources(root, { group, meshes: grid });

    expect(root.children).not.toContain(group);
    for (const dispose of disposals.geometryAndMesh) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of disposals.materials) expect(dispose).not.toHaveBeenCalled();
  });

  it("removes and disposes loose render objects", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    root.add(mesh);
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const materialDispose = (mesh.material as THREE.Material[]).map((material) => vi.spyOn(material, "dispose"));

    removeAndDisposeObjects(root, [mesh]);

    expect(root.children).not.toContain(mesh);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    for (const dispose of materialDispose) expect(dispose).toHaveBeenCalledTimes(1);
  });
});

function fakeHandle(): TreeMaterialHandle {
  return {
    regularMaterial: new THREE.MeshBasicMaterial(),
    debugMaterials: {
      near: new THREE.MeshBasicMaterial(),
      mid: new THREE.MeshBasicMaterial(),
      far: new THREE.MeshBasicMaterial(),
      impostor: new THREE.MeshBasicMaterial(),
    },
    setTime() {},
    updateSettings() {},
    dispose: vi.fn(),
  } as TreeMaterialHandle;
}

function meshGrid(): TreeSystemMeshGrid {
  const grid = {} as TreeSystemMeshGrid;
  for (const species of TREE_SPECIES) {
    grid[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
    for (const lod of TREE_LODS) {
      grid[species][lod] = new THREE.InstancedMesh(
        new THREE.BoxGeometry(),
        new THREE.MeshBasicMaterial(),
        1,
      );
    }
  }
  return grid;
}

function spyGridDisposals(grid: TreeSystemMeshGrid): {
  geometryAndMesh: MockInstance[];
  materials: MockInstance[];
} {
  const geometryAndMesh: MockInstance[] = [];
  const materials: MockInstance[] = [];
  for (const species of TREE_SPECIES as readonly TreeSpeciesId[]) {
    for (const lod of TREE_LODS) {
      geometryAndMesh.push(vi.spyOn(grid[species][lod].geometry, "dispose"));
      geometryAndMesh.push(vi.spyOn(grid[species][lod], "dispose"));
      materials.push(vi.spyOn(grid[species][lod].material as THREE.Material, "dispose"));
    }
  }
  return { geometryAndMesh, materials };
}
