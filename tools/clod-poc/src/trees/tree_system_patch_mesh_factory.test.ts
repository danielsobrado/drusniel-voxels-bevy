import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  attachTreePatchInstanceAttributes,
  createTreePatchLodMesh,
  createTreePatchMeshGroup,
} from "./tree_system_patch_mesh_factory.js";
import { TREE_LODS, TREE_SPECIES, type TreeInstance, type TreeLod, type TreeSpeciesId } from "./index.js";

describe("tree patch mesh factory", () => {
  it("creates one mesh per species and LOD", () => {
    const material = new THREE.MeshBasicMaterial();
    const geometryFor = vi.fn(() => new THREE.BoxGeometry(1, 1, 1));
    const materialFor = vi.fn(() => material);
    const castsShadow = vi.fn((lod: TreeLod) => lod === "near");

    const result = createTreePatchMeshGroup({
      nodeId: "L0:0,0",
      instances: [tree("oak"), tree("oak"), tree("pine")],
      geometryFor,
      materialFor,
      castsShadow,
    });

    expect(result.group.name).toBe("tree-patch-L0:0,0");
    expect(result.group.children).toHaveLength(TREE_SPECIES.length * TREE_LODS.length);
    expect(geometryFor).toHaveBeenCalledTimes(TREE_SPECIES.length * TREE_LODS.length);
    expect(materialFor).toHaveBeenCalledTimes(TREE_SPECIES.length * TREE_LODS.length);
    expect(castsShadow).toHaveBeenCalledTimes(TREE_SPECIES.length * TREE_LODS.length);
    expect(result.meshes.oak.near.instanceMatrix.count).toBe(2);
    expect(result.meshes.pine.near.instanceMatrix.count).toBe(1);
    expect(result.meshes.dead.near.instanceMatrix.count).toBe(1);
    expect(result.meshes.oak.near.castShadow).toBe(true);
    expect(result.meshes.oak.mid.castShadow).toBe(false);
  });

  it("creates a configured LOD mesh", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    const material = new THREE.MeshBasicMaterial();
    const mesh = createTreePatchLodMesh({
      nodeId: "node",
      species: "dead",
      lod: "impostor",
      capacity: 3,
      geometry: source,
      material,
      castShadow: false,
    });

    expect(mesh.name).toBe("trees-node-dead-impostor");
    expect(mesh.count).toBe(3);
    expect(mesh.frustumCulled).toBe(true);
    expect(mesh.visible).toBe(false);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.geometry).not.toBe(source);
    expect(mesh.geometry.getAttribute("treeWorldXZ").count).toBe(3);
    expect(mesh.geometry.getAttribute("treeIdentityBits").count).toBe(3);
    expect(mesh.geometry.getAttribute("treeLodFade").count).toBe(3);
    expect(mesh.geometry.getAttribute("treeLodDitherRole").count).toBe(3);
    expect(mesh.geometry.getAttribute("treeImpostorUvRect").count).toBe(3);
  });

  it("attaches impostor UV rect only for impostor LOD", () => {
    const near = new THREE.BufferGeometry();
    const impostor = new THREE.BufferGeometry();
    attachTreePatchInstanceAttributes(near, "near", 2);
    attachTreePatchInstanceAttributes(impostor, "impostor", 2);

    expect(near.getAttribute("treeWorldXZ").itemSize).toBe(2);
    expect(near.getAttribute("treeLodFade").itemSize).toBe(1);
    expect(near.getAttribute("treeLodDitherRole").itemSize).toBe(1);
    expect(near.getAttribute("treeLodDitherRole").getX(0)).toBe(0);
    expect(near.getAttribute("treeImpostorUvRect")).toBeUndefined();
    expect(impostor.getAttribute("treeImpostorUvRect").itemSize).toBe(4);
    expect(impostor.getAttribute("treeLodFade").getX(0)).toBe(1);
  });
});

function tree(species: TreeSpeciesId): TreeInstance {
  return {
    position: [0, 0, 0],
    normalY: 1,
    species,
    scale: 1,
    rotationY: 0,
  } as TreeInstance;
}
