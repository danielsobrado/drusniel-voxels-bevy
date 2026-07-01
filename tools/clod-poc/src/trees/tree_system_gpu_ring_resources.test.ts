import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { octFrames } from "./tree_impostor_octahedral.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeWebGpuBackendAccess } from "./tree_system_types.js";
import { createTreeSystemGpuRingDrawResources } from "./tree_system_gpu_ring_resources.js";

const materialFactoryMocks = vi.hoisted(() => ({
  regular: vi.fn(),
  impostor: vi.fn(),
}));

vi.mock("./tree_node_material.js", () => ({
  createTreeRingNodeMaterialHandle: materialFactoryMocks.regular,
}));

vi.mock("./tree_ring_impostor_node_material.js", () => ({
  createTreeRingImpostorNodeMaterialHandle: materialFactoryMocks.impostor,
}));

describe("tree system GPU ring resources", () => {
  beforeEach(() => {
    materialFactoryMocks.regular.mockReset();
    materialFactoryMocks.impostor.mockReset();
    materialFactoryMocks.regular.mockImplementation((_settings, _buffers, lod: string) => fakeHandle(`regular:${lod}`));
    materialFactoryMocks.impostor.mockImplementation((_settings, _buffers, atlas: TreeImpostorAtlas) =>
      fakeHandle(`impostor:${atlas.species}`),
    );
  });

  it("switches the impostor LOD from regular ring material to baked impostor material when the atlas is ready", () => {
    const pending = createResources({ oak: atlas("oak", false) });

    expect(pending.materialHandles["oak:impostor"].regularMaterial.name).toBe("regular:impostor");
    expect(materialFactoryMocks.impostor).not.toHaveBeenCalled();

    materialFactoryMocks.regular.mockClear();
    const readyAtlas = atlas("oak", true);
    const ready = createResources({ oak: readyAtlas });

    expect(ready.materialHandles["oak:impostor"].regularMaterial.name).toBe("impostor:oak");
    expect(materialFactoryMocks.impostor).toHaveBeenCalledTimes(1);
    expect(materialFactoryMocks.impostor.mock.calls[0]?.[2]).toBe(readyAtlas);
  });
});

function createResources(impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>) {
  const settings = settingsForTest();
  const sourceGeometry = new THREE.BoxGeometry(1, 1, 1);
  return createTreeSystemGpuRingDrawResources({
    backend: fakeBackend(),
    root: new THREE.Group(),
    ringPrepassTwins: [],
    settings,
    worldCells: 64,
    currentLighting: undefined,
    hydrologyWater: undefined,
    impostorAtlases,
    crownProxyGeometry: sourceGeometry,
    useTreePrepass: false,
    geometryForGpuRing: () => sourceGeometry,
  }, 2);
}

function settingsForTest(): TreeSettings {
  const settings = cloneTreeSettings();
  settings.impostors.enabled = true;
  settings.lod.shadowsMaxLod = "none";
  return settings;
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

function fakeHandle(name: string): TreeMaterialHandle {
  const regularMaterial = new THREE.MeshBasicMaterial();
  const debugMaterial = new THREE.MeshBasicMaterial();
  regularMaterial.name = name;
  debugMaterial.name = `${name}:debug`;
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

function atlas(species: TreeSpeciesId, ready: boolean): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalDepth = new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1);
  return {
    species,
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: octFrames(8, 128, 2),
    radius: 1,
    centerY: 0,
    ready,
    dispose() {
      albedo.dispose();
      normalDepth.dispose();
    },
  };
}
