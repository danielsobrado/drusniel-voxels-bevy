import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeSpeciesId } from "./tree_config.js";
import {
  createTreeCrownProxyGeometry,
  TREE_CROWN_PROXY_INDEX_COUNT,
} from "./tree_crown_proxy_math.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeWebGpuBackendAccess } from "./tree_system_types.js";
import {
  createTreeSystemGpuRingDrawResources,
  treeGpuRingUsesCrownProxyShadowGeometry,
} from "./tree_system_gpu_ring_resources.js";

const materialFactoryMocks = vi.hoisted(() => ({
  regular: vi.fn(),
  impostor: vi.fn(),
  far: vi.fn(),
  crown: vi.fn(),
}));

vi.mock("./tree_node_material.js", () => ({
  createTreeRingNodeMaterialHandle: materialFactoryMocks.regular,
}));

vi.mock("./tree_ring_impostor_node_material.js", () => ({
  createTreeRingImpostorNodeMaterialHandle: materialFactoryMocks.impostor,
}));

vi.mock("./tree_ring_far_node_material.js", () => ({
  createTreeRingFarNodeMaterialHandle: materialFactoryMocks.far,
  treeRingUsesFarMaterial: (lod: string) => lod === "far" || lod === "impostor",
}));

vi.mock("./tree_crown_proxy_node_material.js", () => ({
  createTreeCrownProxyNodeMaterialHandle: materialFactoryMocks.crown,
}));

vi.mock("./tree_material_parity.js", () => ({
  decorateTreeMaterialHandle: (handle: TreeMaterialHandle) => handle,
}));

vi.mock("./tree_ring_lod_crossfade_material.js", () => ({
  decorateTreeRingLodCrossfade: (handle: TreeMaterialHandle) => handle,
}));

describe("tree GPU ring crown proxy shadows", () => {
  beforeEach(() => {
    for (const factory of Object.values(materialFactoryMocks)) {
      factory.mockReset();
      factory.mockImplementation(() => fakeHandle());
    }
  });

  it("uses fitted proxy geometry for far and impostor shadow draws", () => {
    const source = new THREE.BoxGeometry(1, 1, 1);
    const crownProxy = createTreeCrownProxyGeometry();
    const settings = cloneTreeSettings();
    settings.lod.shadowsMaxLod = "impostor";

    const resources = createTreeSystemGpuRingDrawResources({
      backend: fakeBackend(),
      root: new THREE.Group(),
      ringPrepassTwins: [],
      settings,
      worldCells: 64,
      currentLighting: undefined,
      hydrologyWater: undefined,
      impostorAtlases: {},
      foliageAtlas: fakeFoliageAtlas(),
      crownProxyGeometry: crownProxy,
      useTreePrepass: false,
      treePrepassMaxLod: "none",
      geometryForGpuRing: () => source,
    }, 2);

    const near = findMesh(resources.meshes, "trees-ring-gpu-shadow-c0-oak-near");
    const far = findMesh(resources.meshes, "trees-ring-gpu-shadow-c0-oak-far");
    const impostor = findMesh(resources.meshes, "trees-ring-gpu-shadow-c0-oak-impostor");

    expect(near.geometry.getAttribute("position")).toBe(source.getAttribute("position"));
    expect(near.geometry.getIndex()).toBe(source.getIndex());
    expect(far.geometry.getAttribute("position")).toBe(crownProxy.getAttribute("position"));
    expect(far.geometry.getIndex()).toBe(crownProxy.getIndex());
    expect(impostor.geometry.getAttribute("position")).toBe(crownProxy.getAttribute("position"));
    expect(impostor.geometry.getIndex()).toBe(crownProxy.getIndex());
    expect(far.geometry.getIndex()?.count).toBe(TREE_CROWN_PROXY_INDEX_COUNT);
    expect(materialFactoryMocks.crown).toHaveBeenCalled();
  });

  it("rejects a proxy shape that disagrees with the compute draw contract", () => {
    const source = new THREE.BoxGeometry(1, 1, 1);
    const incompatibleProxy = new THREE.SphereGeometry(1, 8, 4);
    const settings = cloneTreeSettings();
    settings.lod.shadowsMaxLod = "far";

    expect(() => createTreeSystemGpuRingDrawResources({
      backend: fakeBackend(),
      root: new THREE.Group(),
      ringPrepassTwins: [],
      settings,
      worldCells: 64,
      currentLighting: undefined,
      hydrologyWater: undefined,
      impostorAtlases: {},
      foliageAtlas: fakeFoliageAtlas(),
      crownProxyGeometry: incompatibleProxy,
      useTreePrepass: false,
      treePrepassMaxLod: "none",
      geometryForGpuRing: () => source,
    }, 2)).toThrow(`expected ${TREE_CROWN_PROXY_INDEX_COUNT}`);
  });

  it("uses proxy geometry only for far-field shadow LODs", () => {
    expect(treeGpuRingUsesCrownProxyShadowGeometry("near")).toBe(false);
    expect(treeGpuRingUsesCrownProxyShadowGeometry("mid")).toBe(false);
    expect(treeGpuRingUsesCrownProxyShadowGeometry("far")).toBe(true);
    expect(treeGpuRingUsesCrownProxyShadowGeometry("impostor")).toBe(true);
  });
});

function findMesh(meshes: readonly THREE.Mesh[], name: string): THREE.Mesh {
  const mesh = meshes.find((candidate) => candidate.name === name);
  if (!mesh) throw new Error(`Missing test mesh ${name}`);
  return mesh;
}

function fakeBackend(): TreeWebGpuBackendAccess {
  const buffers = new WeakMap<THREE.BufferAttribute, GPUBuffer>();
  const register = (attribute: THREE.BufferAttribute) => buffers.set(attribute, {} as GPUBuffer);
  return {
    createStorageAttribute: vi.fn(register),
    createIndirectStorageAttribute: vi.fn(register),
    get: vi.fn((attribute: THREE.BufferAttribute) => ({ buffer: buffers.get(attribute) })),
  };
}

function fakeHandle(): TreeMaterialHandle {
  const regularMaterial = new THREE.MeshBasicMaterial();
  const debugMaterial = new THREE.MeshBasicMaterial();
  return {
    regularMaterial,
    debugMaterials: {
      near: debugMaterial,
      mid: debugMaterial,
      far: debugMaterial,
      impostor: debugMaterial,
    },
    setTime() {},
    updateSettings() {},
    dispose() {
      regularMaterial.dispose();
      debugMaterial.dispose();
    },
  };
}

function fakeFoliageAtlas(): TreeFoliageAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    texture,
    columns: 1,
    rows: 1,
    cellSize: 1,
    dispose() {
      texture.dispose();
    },
  };
}

void (null as TreeSpeciesId | null);
