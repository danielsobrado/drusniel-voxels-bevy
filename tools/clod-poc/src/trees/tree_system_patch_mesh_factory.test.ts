import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  attachTreePatchInstanceAttributes,
  createTreePatchLodMesh,
  createTreePatchMeshGroup,
  disposeTreePatchGeometry,
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

  it("shares template vertex buffers across patches instead of cloning them", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    const material = new THREE.MeshBasicMaterial();
    const lodMesh = (nodeId: string) => createTreePatchLodMesh({
      nodeId, species: "oak", lod: "near", capacity: 4, geometry: source, material, castShadow: false,
    });

    const a = lodMesh("L0:0,0");
    const b = lodMesh("L0:1,0");

    // Same attribute objects, so the vertex data is uploaded and held once.
    expect(a.geometry.getAttribute("position")).toBe(source.getAttribute("position"));
    expect(b.geometry.getAttribute("position")).toBe(source.getAttribute("position"));
    expect(a.geometry.index).toBe(source.index);
    // Instance attributes stay per patch.
    expect(a.geometry.getAttribute("treeWorldXZ")).not.toBe(b.geometry.getAttribute("treeWorldXZ"));
  });

  it("disposing one patch leaves the shared template buffers intact for other patches", () => {
    const source = new THREE.PlaneGeometry(1, 2);
    const material = new THREE.MeshBasicMaterial();
    const lodMesh = (nodeId: string) => createTreePatchLodMesh({
      nodeId, species: "oak", lod: "near", capacity: 4, geometry: source, material, castShadow: false,
    });
    const a = lodMesh("L0:0,0");
    const b = lodMesh("L0:1,0");

    const released: string[] = [];
    a.geometry.addEventListener("dispose", () => {
      // Whatever is still attached at dispose time is what three will free.
      released.push(...Object.keys(a.geometry.attributes));
      if (a.geometry.index) released.push("index");
    });

    disposeTreePatchGeometry(a.geometry);

    // Only patch-owned instance attributes may be released.
    expect(released).not.toContain("position");
    expect(released).not.toContain("index");
    expect(released).toContain("treeWorldXZ");
    // The surviving patch and the template are untouched.
    expect(b.geometry.getAttribute("position")).toBe(source.getAttribute("position"));
    expect(source.getAttribute("position").array.length).toBeGreaterThan(0);
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

  it("packs float instance attributes into one WebGPU vertex buffer", () => {
    const geometry = new THREE.BufferGeometry();
    attachTreePatchInstanceAttributes(geometry, "impostor", 2);
    const names = [
      "treeWorldXZ",
      "treeLodFade",
      "treeLodDitherRole",
      "treeMorphology0",
      "treeMorphology1",
      "treeMorphology2",
      "treeImpostorUvRect",
      "treeImpostorLocalPositionScale",
      "treeImpostorUvRect0",
      "treeImpostorUvRect1",
      "treeImpostorUvRect2",
      "treeImpostorUvRect3",
      "treeImpostorBlendWeights",
    ];
    const attributes = names.map((name) => geometry.getAttribute(name));

    expect(attributes.every((attribute) => attribute instanceof THREE.InterleavedBufferAttribute)).toBe(true);
    const buffers = new Set(attributes.map((attribute) => (attribute as THREE.InterleavedBufferAttribute).data));
    expect(buffers.size).toBe(1);
    expect((attributes[0] as THREE.InterleavedBufferAttribute).data).toBeInstanceOf(THREE.InstancedInterleavedBuffer);
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
