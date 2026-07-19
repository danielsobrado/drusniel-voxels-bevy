import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { TreeMaterialHandle } from "./tree_material.js";
import { cloneTreeSettings } from "./tree_config.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeWebGpuBackendAccess } from "./tree_system_types.js";
import { createTreeSystemGpuRingDrawResources } from "./tree_system_gpu_ring_resources.js";

const factories = vi.hoisted(() => ({
  regular: vi.fn(),
  impostor: vi.fn(),
  far: vi.fn(),
  crown: vi.fn(),
}));

vi.mock("./tree_node_material.js", () => ({
  createTreeRingNodeMaterialHandle: factories.regular,
}));

vi.mock("./tree_ring_impostor_node_material.js", () => ({
  createTreeRingImpostorNodeMaterialHandle: factories.impostor,
}));

vi.mock("./tree_ring_far_node_material.js", () => ({
  createTreeRingFarNodeMaterialHandle: factories.far,
  treeRingUsesFarMaterial: () => false,
}));

vi.mock("./tree_crown_proxy_node_material.js", () => ({
  createTreeCrownProxyNodeMaterialHandle: factories.crown,
}));

vi.mock("./tree_material_parity.js", () => ({
  decorateTreeMaterialHandle: (handle: TreeMaterialHandle) => handle,
}));

vi.mock("./tree_ring_lod_crossfade_material.js", () => ({
  decorateTreeRingLodCrossfade: (handle: TreeMaterialHandle) => handle,
}));

describe("tree GPU ring creation rollback", () => {
  beforeEach(() => {
    factories.regular.mockReset();
    factories.impostor.mockReset();
    factories.far.mockReset();
    factories.crown.mockReset();
  });

  it("releases the partially built generation when a later material fails", () => {
    const first = fakeHandle();
    factories.regular
      .mockReturnValueOnce(first.handle)
      .mockImplementationOnce(() => {
        throw new Error("mid material failed");
      });
    const geometryDispose = vi.spyOn(THREE.InstancedBufferGeometry.prototype, "dispose");
    const settings = cloneTreeSettings();
    settings.impostors.enabled = false;
    settings.render.farCheapMaterial = false;
    settings.lod.shadowsMaxLod = "none";
    const root = new THREE.Group();
    const ringPrepassTwins: THREE.Mesh[] = [];
    const source = new THREE.BoxGeometry(1, 1, 1);

    expect(() => createTreeSystemGpuRingDrawResources({
      backend: fakeBackend(),
      root,
      ringPrepassTwins,
      settings,
      worldCells: 64,
      currentLighting: undefined,
      currentForestLighting: null,
      hydrologyWater: undefined,
      impostorAtlases: {},
      foliageAtlas: fakeFoliageAtlas(),
      crownProxyGeometry: source,
      useTreePrepass: false,
      treePrepassMaxLod: "none",
      geometryForGpuRing: () => source,
    }, 2)).toThrow("mid material failed");

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(root.children).toHaveLength(0);
    expect(ringPrepassTwins).toHaveLength(0);
  });
});

function fakeHandle(): { handle: TreeMaterialHandle; dispose: ReturnType<typeof vi.fn> } {
  const regularMaterial = new THREE.MeshBasicMaterial();
  const debugMaterial = new THREE.MeshBasicMaterial();
  const dispose = vi.fn(() => {
    regularMaterial.dispose();
    debugMaterial.dispose();
  });
  return {
    handle: {
      regularMaterial,
      debugMaterials: {
        near: debugMaterial,
        mid: debugMaterial,
        far: debugMaterial,
        impostor: debugMaterial,
      },
      setTime() {},
      updateSettings() {},
      dispose,
    },
    dispose,
  };
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
