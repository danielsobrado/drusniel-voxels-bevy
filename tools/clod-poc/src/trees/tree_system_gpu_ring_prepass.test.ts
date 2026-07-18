import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  addTreeGpuRingPrepassTwin,
  parseTreeDepthPrepassMaxLod,
  treeLodWithinDepthPrepass,
  treeSystemUsesGpuRingPrepass,
  type TreeMaterialHandle,
} from "./index.js";

describe("tree depth prepass runtime helpers", () => {
  it("parses tree prepass max LOD safely", () => {
    expect(parseTreeDepthPrepassMaxLod("none")).toBe("none");
    expect(parseTreeDepthPrepassMaxLod("near")).toBe("near");
    expect(parseTreeDepthPrepassMaxLod("mid")).toBe("mid");
    expect(parseTreeDepthPrepassMaxLod("far")).toBe("far");
    expect(parseTreeDepthPrepassMaxLod("impostor")).toBe("impostor");
    expect(parseTreeDepthPrepassMaxLod("bad")).toBe("none");
    expect(parseTreeDepthPrepassMaxLod(null)).toBe("none");
  });

  it("limits prepass by max LOD", () => {
    expect(treeLodWithinDepthPrepass("none", "near")).toBe(false);
    expect(treeLodWithinDepthPrepass("near", "near")).toBe(true);
    expect(treeLodWithinDepthPrepass("near", "mid")).toBe(false);
    expect(treeLodWithinDepthPrepass("mid", "near")).toBe(true);
    expect(treeLodWithinDepthPrepass("mid", "mid")).toBe(true);
    expect(treeLodWithinDepthPrepass("mid", "far")).toBe(false);
    expect(treeLodWithinDepthPrepass("far", "far")).toBe(true);
    expect(treeLodWithinDepthPrepass("far", "impostor")).toBe(false);
    expect(treeLodWithinDepthPrepass("impostor", "impostor")).toBe(true);
  });
});

describe("tree system GPU ring prepass helpers", () => {
  it("uses prepass only when enabled and within max LOD", () => {
    expect(treeSystemUsesGpuRingPrepass(true, "far", "near")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(true, "far", "mid")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(true, "far", "far")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(true, "far", "impostor")).toBe(false);
    expect(treeSystemUsesGpuRingPrepass(true, "impostor", "impostor")).toBe(true);
    expect(treeSystemUsesGpuRingPrepass(false, "impostor", "impostor")).toBe(false);
    expect(treeSystemUsesGpuRingPrepass(true, "near", "mid")).toBe(false);
    expect(treeSystemUsesGpuRingPrepass(true, "none", "near")).toBe(false);
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
      maxLod: "impostor",
    });

    expect(twin).toBeNull();
    expect(twins).toHaveLength(0);
    expect(root.children).toHaveLength(0);
  });

  it("does not create a twin for LODs outside max LOD", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "mid",
      mesh,
      materialHandle: handleWithNodes(true),
      useTreePrepass: true,
      maxLod: "near",
    });

    expect(twin).toBeNull();
    expect(twins).toHaveLength(0);
    expect(root.children).toHaveLength(0);
  });

  it("creates a twin for impostors when the max LOD includes them", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = "trees-ring-gpu-oak-impostor";
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "impostor",
      mesh,
      materialHandle: handleWithNodes(true),
      useTreePrepass: true,
      maxLod: "impostor",
    });

    expect(twin?.name).toBe("trees-ring-gpu-oak-impostor-depth-prepass");
    expect(twins).toEqual([twin]);
    expect(root.children).toEqual([twin]);
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
      maxLod: "impostor",
    });

    expect(twin).toBeNull();
    expect(twins).toHaveLength(0);
    expect(root.children).toHaveLength(0);
  });

  it("creates and registers a depth prepass twin without cloning the color material", () => {
    const root = new THREE.Group();
    const twins: THREE.Mesh[] = [];
    const sourceMaterial = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), sourceMaterial);
    mesh.name = "trees-ring-gpu-oak-near";
    const twin = addTreeGpuRingPrepassTwin({
      root,
      twins,
      lod: "near",
      mesh,
      materialHandle: handleWithNodes(true),
      useTreePrepass: true,
      maxLod: "impostor",
    });

    expect(twin).toBeDefined();
    expect(twin?.name).toBe("trees-ring-gpu-oak-near-depth-prepass");
    expect(twins).toEqual([twin]);
    expect(root.children).toEqual([twin]);
    expect(twin?.geometry).toBe(mesh.geometry);
    expect(twin?.frustumCulled).toBe(false);
    expect(twin?.renderOrder).toBe(-100);
    expect(mesh.material).toBe(sourceMaterial);
    expect(sourceMaterial.depthWrite).toBe(false);
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
