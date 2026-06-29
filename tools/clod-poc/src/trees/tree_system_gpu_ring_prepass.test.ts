import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  addTreeGpuRingPrepassTwin,
  treeSystemUsesGpuRingPrepass,
  type TreeMaterialHandle,
} from "./index.js";

describe("tree system GPU ring prepass helpers", () => {
  it("uses prepass only when enabled and not impostor", () => {
    expect(treeSystemUsesGpuRingPrepass(true, "near")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(true, "mid")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(true, "far")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(true, "impostor")).toBe(false);
    expect(treeSystemUsesGpuRingPrepass(false, "near")).toBe(false);
  });

  it("does not create a twin when prepass is disabled", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "near",
      mesh,
      materialHandle: handleWithNodes(true),
      useTreePrepass: false,
    });

    expect(twin).toBeNull();
    expect(twins).toHaveLength(0);
    expect(root.children).toHaveLength(0);
  });

  it("does not create a twin for impostor LOD", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "impostor",
      mesh,
      materialHandle: handleWithNodes(true),
      useTreePrepass: true,
    });

    expect(twin).toBeNull();
    expect(twins).toHaveLength(0);
    expect(root.children).toHaveLength(0);
  });

  it("does not create a twin when the material has no prepass nodes", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "near",
      mesh,
      materialHandle: handleWithNodes(false),
      useTreePrepass: true,
    });

    expect(twin).toBeNull();
    expect(twins).toHaveLength(0);
    expect(root.children).toHaveLength(0);
  });

  it("creates and registers a depth prepass twin", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = "trees-ring-gpu-oak-near";
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "near",
      mesh,
      materialHandle: handleWithNodes(true),
      useTreePrepass: true,
    });

    expect(twin).toBeDefined();
    expect(twin?.name).toBe("trees-ring-gpu-oak-near-depth-prepass");
    expect(twins).toEqual([twin]);
    expect(root.children).toEqual([twin]);
    expect(twin?.geometry).toBe(mesh.geometry);
    expect(twin?.frustumCulled).toBe(false);
    expect(twin?.renderOrder).toBe(-100);
    expect((mesh.material as THREE.Material).depthWrite).toBe(false);
  });
});

function handleWithNodes(withNodes: boolean): TreeMaterialHandle {
  const material = new THREE.MeshBasicMaterial();
  return {
    regularMaterial: material,
    debugMaterials: {
      near: material,
      mid: material,
      far: material,
      impostor: material,
    },
    setTime() {},
    updateSettings() {},
    dispose() {},
    prepassNodesFor: withNodes
      ? () => ({ positionNode: {}, side: THREE.DoubleSide })
      : () => undefined,
  } as TreeMaterialHandle;
}
