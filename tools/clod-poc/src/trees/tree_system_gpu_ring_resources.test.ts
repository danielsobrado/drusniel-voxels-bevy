import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  cloneForestLightingSettings,
  type ForestLightingMaterialState,
} from "../forest_lighting/index.js";
import { TREE_GPU_RING_SHADOW_GROUP_COUNT } from "../gpu/tree_ring_compute.js";
import {
  cloneTreeSettings,
  TREE_LODS,
  TREE_SPECIES,
  type TreeSettings,
  type TreeSpeciesId,
} from "./tree_config.js";
import { octFrames } from "./tree_impostor_octahedral.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import { TREE_GPU_RING_INSTANCE_VEC4S } from "./tree_system_gpu_ring_draw.js";
import type { TreeWebGpuBackendAccess } from "./tree_system_types.js";
import {
  createTreeSystemGpuRingDrawResources,
  refreshTreeSystemGpuRingImpostorResources,
  TREE_GPU_RING_DISABLED_SHADOW_CAPACITY_PER_GROUP,
  treeGpuRingAllocatedShadowCapacityPerGroup,
  type TreeGpuRingDrawResourcesInput,
} from "./tree_system_gpu_ring_resources.js";

const materialFactoryMocks = vi.hoisted(() => ({
  regular: vi.fn(),
  impostor: vi.fn(),
  far: vi.fn(),
  forestUpdates: [] as Array<{ name: string; state: unknown }>,
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

vi.mock("./tree_material_parity.js", () => ({
  decorateTreeMaterialHandle: (handle: TreeMaterialHandle) => handle,
}));

describe("tree system GPU ring resources", () => {
  beforeEach(() => {
    materialFactoryMocks.regular.mockReset();
    materialFactoryMocks.impostor.mockReset();
    materialFactoryMocks.far.mockReset();
    materialFactoryMocks.forestUpdates.length = 0;
    materialFactoryMocks.regular.mockImplementation((_settings: unknown, _buffers: unknown, lod: string) => fakeHandle(`regular:${lod}`));
    materialFactoryMocks.impostor.mockImplementation((_settings: unknown, _buffers: unknown, atlas: TreeImpostorAtlas) =>
      fakeHandle(`impostor:${atlas.species}`),
    );
    materialFactoryMocks.far.mockImplementation((_settings: unknown, _buffers: unknown, lod: string) => fakeHandle(`far:${lod}`));
  });

  it("switches the impostor LOD from regular ring material to baked impostor material when the atlas is ready", () => {
    const pending = createResources({ oak: atlas("oak", false) });
    expect(pending.materialHandles["oak:impostor"].regularMaterial.name).toBe("far:impostor");
    expect(materialFactoryMocks.impostor).not.toHaveBeenCalled();

    materialFactoryMocks.regular.mockClear();
    const readyAtlas = atlas("oak", true);
    const ready = createResources({ oak: readyAtlas });
    expect(ready.materialHandles["oak:impostor"].regularMaterial.name).toBe("impostor:oak");
    expect(materialFactoryMocks.impostor).toHaveBeenCalledTimes(1);
    expect(materialFactoryMocks.impostor.mock.calls[0]?.[2]).toBe(readyAtlas);
  });

  it("applies active forest lighting to every visible handle during resource creation", () => {
    const state = forestState();

    createResources({ oak: atlas("oak", true) }, undefined, undefined, state);

    const applied = materialFactoryMocks.forestUpdates.filter((update) => update.state === state);
    expect(applied).toHaveLength(TREE_SPECIES.length * TREE_LODS.length);
    expect(applied.some((update) => update.name === "impostor:oak")).toBe(true);
    expect(applied.some((update) => update.name === "regular:near")).toBe(true);
    expect(applied.some((update) => update.name === "far:far")).toBe(true);
  });

  it("applies active forest lighting before publishing a refreshed impostor handle", () => {
    const sourceGeometry = new THREE.BoxGeometry(1, 1, 1);
    const settings = settingsForTest();
    const state = forestState();
    const pendingInput = resourcesInput({ oak: atlas("oak", false) }, sourceGeometry, settings, state);
    const resources = createTreeSystemGpuRingDrawResources(pendingInput, 2);
    materialFactoryMocks.forestUpdates.length = 0;

    const readyInput = resourcesInput({ oak: atlas("oak", true) }, sourceGeometry, settings, state);
    expect(refreshTreeSystemGpuRingImpostorResources(readyInput, resources)).toBe(true);

    expect(materialFactoryMocks.forestUpdates).toContainEqual({ name: "impostor:oak", state });
    expect(resources.materialHandles["oak:impostor"].regularMaterial.name).toBe("impostor:oak");
  });

  it("does not create renderable GPU ring meshes for empty source geometry", () => {
    const resources = createResources({}, new THREE.BufferGeometry());
    expect(resources.meshes).toHaveLength(0);
  });

  it("keeps only sentinel shadow storage when tree shadows are disabled", () => {
    const resources = createResources({});

    expect(TREE_GPU_RING_DISABLED_SHADOW_CAPACITY_PER_GROUP).toBe(1);
    expect(resources.shadowCell.count).toBe(
      TREE_GPU_RING_SHADOW_GROUP_COUNT * TREE_GPU_RING_INSTANCE_VEC4S,
    );
  });

  it("restores the requested per-group capacity when any tree LOD casts shadows", () => {
    const settings = settingsForTest();
    settings.lod.shadowsMaxLod = "far";

    expect(treeGpuRingAllocatedShadowCapacityPerGroup(settings, 27)).toBe(27);
    settings.lod.shadowsMaxLod = "none";
    expect(treeGpuRingAllocatedShadowCapacityPerGroup(settings, 27)).toBe(1);
  });
});

function createResources(
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>,
  sourceGeometry: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1),
  settings: TreeSettings = settingsForTest(),
  currentForestLighting: ForestLightingMaterialState | null = null,
) {
  return createTreeSystemGpuRingDrawResources(
    resourcesInput(impostorAtlases, sourceGeometry, settings, currentForestLighting),
    2,
  );
}

function resourcesInput(
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>,
  sourceGeometry: THREE.BufferGeometry,
  settings: TreeSettings,
  currentForestLighting: ForestLightingMaterialState | null,
): TreeGpuRingDrawResourcesInput {
  return {
    backend: fakeBackend(),
    root: new THREE.Group(),
    ringPrepassTwins: [],
    settings,
    worldCells: 64,
    currentLighting: undefined,
    currentForestLighting,
    hydrologyWater: undefined,
    impostorAtlases,
    foliageAtlas: fakeFoliageAtlas(),
    crownProxyGeometry: sourceGeometry,
    useTreePrepass: false,
    treePrepassMaxLod: "far",
    geometryForGpuRing: () => sourceGeometry,
  };
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
    updateForestLighting(state) {
      materialFactoryMocks.forestUpdates.push({ name, state });
    },
    dispose() {
      regularMaterial.dispose();
      debugMaterial.dispose();
    },
  };
}

function forestState(): ForestLightingMaterialState {
  const texture = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
  const auxTexture = new THREE.DataTexture(new Uint8Array([5, 6, 7, 8]), 1, 1);
  return {
    worldCells: 64,
    settings: cloneForestLightingSettings(),
    textureHandle: {
      texture,
      auxTexture,
      update() {},
      dispose() {
        texture.dispose();
        auxTexture.dispose();
      },
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
