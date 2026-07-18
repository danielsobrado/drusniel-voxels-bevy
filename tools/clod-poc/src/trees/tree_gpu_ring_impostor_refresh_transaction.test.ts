import { describe, expect, it, vi, type MockInstance } from "vitest";
import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { TREE_GPU_RING_GROUP_COUNT, treeGpuRingGroupIndex } from "../gpu/tree_ring_compute.js";
import { cloneTreeSettings, type TreeSpeciesId } from "./tree_config.js";
import type { TreeFoliageAtlas } from "./tree_alpha_mask.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import {
  refreshTreeGpuRingImpostorsTransactionally,
  type TreeGpuRingImpostorRefreshFactory,
} from "./tree_gpu_ring_impostor_refresh_transaction.js";
import { TREE_GPU_RING_INSTANCE_VEC4S, type TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";
import type { TreeGpuRingDrawResourcesInput } from "./tree_system_gpu_ring_resources.js";
import type { TreeGpuRingDrawResources, TreeWebGpuBackendAccess } from "./tree_system_types.js";

const SPECIES = ["oak", "pine"] as const;
type TestSpecies = (typeof SPECIES)[number];

interface FakeHandle {
  handle: TreeMaterialHandle;
  dispose: ReturnType<typeof vi.fn>;
}

interface FakeGeometry {
  geometry: THREE.InstancedBufferGeometry;
  dispose: MockInstance;
}

interface Fixture {
  input: TreeGpuRingDrawResourcesInput;
  resources: TreeGpuRingDrawResources;
  meshes: Record<TestSpecies, TreeGpuRingMesh>;
  oldGeometries: Record<TestSpecies, FakeGeometry>;
  oldHandles: Record<TestSpecies, FakeHandle>;
  sourceIndexCounts: Record<TestSpecies, number>;
  initialIndirect: number[];
  liveTwins: Partial<Record<TestSpecies, THREE.Mesh>>;
  liveTwinMaterialDisposals: Partial<Record<TestSpecies, MockInstance>>;
}

interface FactoryOptions {
  failMaterialSpecies?: TestSpecies;
  failPrepassSpecies?: TestSpecies;
  createdHandles: FakeHandle[];
  createdGeometries: FakeGeometry[];
  stagedTwinMaterialDisposals: MockInstance[];
}

describe("tree GPU impostor refresh transaction", () => {
  it("preserves all live resources when a later species fails", () => {
    const fixture = createFixture();
    const tracking = trackingOptions({ failMaterialSpecies: "pine" });

    expect(() => refreshTreeGpuRingImpostorsTransactionally(
      fixture.input,
      fixture.resources,
      createFactory(tracking),
    )).toThrow("pine material failed");

    for (const species of SPECIES) {
      expect(fixture.meshes[species].geometry).toBe(fixture.oldGeometries[species].geometry);
      expect(fixture.resources.materialHandles[`${species}:impostor`]).toBe(fixture.oldHandles[species].handle);
      expect(fixture.oldHandles[species].dispose).not.toHaveBeenCalled();
      expect(fixture.oldGeometries[species].dispose).not.toHaveBeenCalled();
    }
    expect(tracking.createdHandles).toHaveLength(1);
    expect(tracking.createdHandles[0].dispose).toHaveBeenCalledTimes(1);
    expect(tracking.createdGeometries).toHaveLength(1);
    expect(tracking.createdGeometries[0].dispose).toHaveBeenCalledTimes(1);
    expect(Array.from(fixture.resources.indirect.array as Uint32Array)).toEqual(fixture.initialIndirect);
  });

  it("publishes all prepared species together and retires the old generation", () => {
    const fixture = createFixture();
    const tracking = trackingOptions();

    expect(refreshTreeGpuRingImpostorsTransactionally(
      fixture.input,
      fixture.resources,
      createFactory(tracking),
    )).toBe(true);

    for (let index = 0; index < SPECIES.length; index++) {
      const species = SPECIES[index];
      expect(fixture.meshes[species].geometry).toBe(tracking.createdGeometries[index].geometry);
      expect(fixture.resources.materialHandles[`${species}:impostor`]).toBe(tracking.createdHandles[index].handle);
      expect(fixture.oldGeometries[species].dispose).toHaveBeenCalledTimes(1);
      expect(fixture.oldHandles[species].dispose).toHaveBeenCalledTimes(1);
      expect(tracking.createdGeometries[index].dispose).not.toHaveBeenCalled();
      expect(tracking.createdHandles[index].dispose).not.toHaveBeenCalled();
      const group = treeGpuRingGroupIndex(species, "impostor");
      expect((fixture.resources.indirect.array as Uint32Array)[group * 5]).toBe(fixture.sourceIndexCounts[species]);
    }
  });

  it("keeps live prepass twins when staged prepass construction fails", () => {
    const fixture = createFixture(true);
    const tracking = trackingOptions({ failPrepassSpecies: "pine" });

    expect(() => refreshTreeGpuRingImpostorsTransactionally(
      fixture.input,
      fixture.resources,
      createFactory(tracking),
    )).toThrow("pine prepass failed");

    expect(fixture.input.ringPrepassTwins).toEqual(SPECIES.map((species) => fixture.liveTwins[species]));
    for (const species of SPECIES) {
      expect(fixture.liveTwins[species]?.parent).toBe(fixture.input.root);
      expect(fixture.liveTwinMaterialDisposals[species]).not.toHaveBeenCalled();
      expect(fixture.meshes[species].geometry).toBe(fixture.oldGeometries[species].geometry);
    }
    expect(tracking.stagedTwinMaterialDisposals).toHaveLength(2);
    expect(tracking.stagedTwinMaterialDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(tracking.createdHandles.every((entry) => entry.dispose.mock.calls.length === 1)).toBe(true);
    expect(tracking.createdGeometries.every((entry) => entry.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("does nothing when no ready atlas can be refreshed", () => {
    const fixture = createFixture();
    fixture.input.impostorAtlases = {};
    const tracking = trackingOptions();
    const factory = createFactory(tracking);
    const createMaterialHandle = vi.spyOn(factory, "createMaterialHandle");

    expect(refreshTreeGpuRingImpostorsTransactionally(
      fixture.input,
      fixture.resources,
      factory,
    )).toBe(false);
    expect(createMaterialHandle).not.toHaveBeenCalled();
  });
});

function trackingOptions(
  failures: Pick<FactoryOptions, "failMaterialSpecies" | "failPrepassSpecies"> = {},
): FactoryOptions {
  return {
    ...failures,
    createdHandles: [],
    createdGeometries: [],
    stagedTwinMaterialDisposals: [],
  };
}

function createFactory(options: FactoryOptions): TreeGpuRingImpostorRefreshFactory {
  let currentSpecies: TestSpecies | undefined;
  return {
    createMaterialHandle(_input, _buffers, species) {
      currentSpecies = species as TestSpecies;
      if (currentSpecies === options.failMaterialSpecies) {
        throw new Error(`${currentSpecies} material failed`);
      }
      const handle = fakeHandle(`next:${currentSpecies}`);
      options.createdHandles.push(handle);
      return handle.handle;
    },
    createGeometry(source, instanceCount) {
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(source.getIndex());
      geometry.setAttribute("position", source.getAttribute("position"));
      geometry.instanceCount = instanceCount;
      const tracked = { geometry, dispose: vi.spyOn(geometry, "dispose") };
      options.createdGeometries.push(tracked);
      return geometry;
    },
    createPrepassTwin(input, mesh) {
      if (!input.useTreePrepass) return null;
      if (!currentSpecies) throw new Error("prepass species missing");
      const material = new THREE.MeshBasicMaterial();
      options.stagedTwinMaterialDisposals.push(vi.spyOn(material, "dispose"));
      const twin = new THREE.Mesh(mesh.geometry, material);
      twin.name = `${mesh.name}-depth-prepass`;
      input.ringPrepassTwins.push(twin);
      input.root.add(twin);
      if (currentSpecies === options.failPrepassSpecies) {
        throw new Error(`${currentSpecies} prepass failed`);
      }
      return twin;
    },
  };
}

function createFixture(withPrepass = false): Fixture {
  const settings = cloneTreeSettings();
  settings.impostors.enabled = true;
  settings.render.debugColorByLod = false;
  const root = new THREE.Group();
  const meshes = {} as Record<TestSpecies, TreeGpuRingMesh>;
  const oldGeometries = {} as Record<TestSpecies, FakeGeometry>;
  const oldHandles = {} as Record<TestSpecies, FakeHandle>;
  const sources = {} as Record<TestSpecies, THREE.BufferGeometry>;
  const sourceIndexCounts = {} as Record<TestSpecies, number>;
  const liveTwins: Partial<Record<TestSpecies, THREE.Mesh>> = {};
  const liveTwinMaterialDisposals: Partial<Record<TestSpecies, MockInstance>> = {};
  const ringPrepassTwins: THREE.Mesh[] = [];

  for (let index = 0; index < SPECIES.length; index++) {
    const species = SPECIES[index];
    const source = indexedSourceGeometry(3 + index * 3);
    sources[species] = source;
    sourceIndexCounts[species] = source.getIndex()!.count;
    oldGeometries[species] = fakeInstancedGeometry(2);
    oldHandles[species] = fakeHandle(`old:${species}`);
    const mesh = new THREE.Mesh(
      oldGeometries[species].geometry,
      oldHandles[species].handle.regularMaterial,
    ) as TreeGpuRingMesh;
    mesh.name = `trees-ring-gpu-${species}-impostor`;
    meshes[species] = mesh;

    if (withPrepass) {
      const material = new THREE.MeshBasicMaterial();
      const twin = new THREE.Mesh(oldGeometries[species].geometry, material);
      twin.name = `${mesh.name}-depth-prepass`;
      liveTwinMaterialDisposals[species] = vi.spyOn(material, "dispose");
      liveTwins[species] = twin;
      ringPrepassTwins.push(twin);
      root.add(twin);
    }
  }

  const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
  const resources: TreeGpuRingDrawResources = {
    meshes: Object.values(meshes),
    cell: new StorageInstancedBufferAttribute(TREE_GPU_RING_INSTANCE_VEC4S * 4, 4),
    indirect,
    shadowCell: new StorageInstancedBufferAttribute(TREE_GPU_RING_INSTANCE_VEC4S, 4),
    shadowIndirect: new StorageBufferAttribute(new Uint32Array(5), 5),
    outputBuffers: {} as TreeGpuRingDrawResources["outputBuffers"],
    materialHandles: Object.fromEntries(
      SPECIES.map((species) => [`${species}:impostor`, oldHandles[species].handle]),
    ),
  };
  const impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = Object.fromEntries(
    SPECIES.map((species) => [species, atlas(species)]),
  );
  return {
    input: {
      backend: fakeBackend(),
      root,
      ringPrepassTwins,
      settings,
      worldCells: 64,
      currentLighting: undefined,
      currentForestLighting: null,
      hydrologyWater: undefined,
      impostorAtlases,
      foliageAtlas: fakeFoliageAtlas(),
      crownProxyGeometry: new THREE.BufferGeometry(),
      useTreePrepass: withPrepass,
      treePrepassMaxLod: "impostor",
      geometryForGpuRing: (species) => sources[species as TestSpecies],
    },
    resources,
    meshes,
    oldGeometries,
    oldHandles,
    sourceIndexCounts,
    initialIndirect: Array.from(indirect.array as Uint32Array),
    liveTwins,
    liveTwinMaterialDisposals,
  };
}

function fakeHandle(name: string): FakeHandle {
  const regularMaterial = new THREE.MeshBasicMaterial();
  regularMaterial.name = name;
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

function fakeInstancedGeometry(instanceCount: number): FakeGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  geometry.instanceCount = instanceCount;
  return { geometry, dispose: vi.spyOn(geometry, "dispose") };
}

function indexedSourceGeometry(indexCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(indexCount * 3), 3));
  geometry.setIndex(Array.from({ length: indexCount }, (_, index) => index));
  return geometry;
}

function atlas(species: TreeSpeciesId): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    species,
    texture: albedo,
    albedo,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: [],
    ready: true,
    dispose() {
      albedo.dispose();
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

function fakeBackend(): TreeWebGpuBackendAccess {
  return {
    createStorageAttribute() {},
    createIndirectStorageAttribute() {},
    get() {
      return {};
    },
  };
}
