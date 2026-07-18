import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "./tree_config.js";
import {
  disposeTreeMeshGrid,
  removeTreePatchResources,
  type TreeSystemMeshGrid,
} from "./tree_system_lifecycle.js";

describe("tree patch resource ownership", () => {
  it("does not dispose shared colour materials when a patch is removed", () => {
    const sharedMaterial = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(sharedMaterial, "dispose");
    const first = createMeshGrid(sharedMaterial);
    const second = createMeshGrid(sharedMaterial);

    disposeTreeMeshGrid(first.grid);

    expect(materialDispose).not.toHaveBeenCalled();
    expect(first.geometryDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(first.depthMaterialDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);

    disposeTreeMeshGrid(second.grid);
    expect(materialDispose).not.toHaveBeenCalled();

    sharedMaterial.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("removes the patch group without releasing its shared colour material", () => {
    const root = new THREE.Group();
    const group = new THREE.Group();
    const sharedMaterial = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(sharedMaterial, "dispose");
    const resources = createMeshGrid(sharedMaterial);
    root.add(group);

    removeTreePatchResources(root, { group, meshes: resources.grid });

    expect(group.parent).toBeNull();
    expect(materialDispose).not.toHaveBeenCalled();
    sharedMaterial.dispose();
  });
});

function createMeshGrid(material: THREE.Material): {
  grid: TreeSystemMeshGrid;
  geometryDisposals: Array<ReturnType<typeof vi.spyOn>>;
  depthMaterialDisposals: Array<ReturnType<typeof vi.spyOn>>;
} {
  const grid = {} as TreeSystemMeshGrid;
  const geometryDisposals: Array<ReturnType<typeof vi.spyOn>> = [];
  const depthMaterialDisposals: Array<ReturnType<typeof vi.spyOn>> = [];

  for (const species of TREE_SPECIES) {
    grid[species] = {} as Record<TreeLod, THREE.InstancedMesh>;
    for (const lod of TREE_LODS) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const geometryDispose = vi.spyOn(geometry, "dispose");
      const mesh = new THREE.InstancedMesh(geometry, material, 1);
      const depthMaterial = new THREE.MeshBasicMaterial();
      const depthDispose = vi.spyOn(depthMaterial, "dispose");
      mesh.userData.depthTwin = new THREE.InstancedMesh(geometry, depthMaterial, 1);
      grid[species as TreeSpeciesId][lod] = mesh;
      geometryDisposals.push(geometryDispose);
      depthMaterialDisposals.push(depthDispose);
    }
  }

  return { grid, geometryDisposals, depthMaterialDisposals };
}
