import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  createNearFieldBubbleController,
  createRequiredStreamingPageCoordCache,
  liveBubbleChunkFootprint,
  liveBubbleOwnsPageView,
  requiredStreamingPageCoords,
} from "./near_field_bubble_controller.js";
import type { ClodPageNode, PageFootprint } from "../../types.js";
import type { ChunkMesh, GpuChunkMesher } from "../../gpu/gpu_chunk_mesher.js";
import type { TerrainMaterialController } from "../material/terrain_material_controller.js";
import type { TerrainColliderSet } from "../../terrain/terrain_collider.js";

const terrainMocks = vi.hoisted(() => ({
  meshChunk: vi.fn((): ChunkMesh => {
    throw new Error("cpu fallback fail");
  }),
  stepChunkMeshBuild: vi.fn(() => true),
}));

vi.mock("../../terrain/terrain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../terrain/terrain.js")>();
  return {
    ...actual,
    meshChunk: terrainMocks.meshChunk,
    createChunkMeshBuild: vi.fn(() => ({})),
    stepChunkMeshBuild: terrainMocks.stepChunkMeshBuild,
    finalizeChunkMeshBuild: terrainMocks.meshChunk,
  };
});

const TEST_CFG = {
  page: { chunks_per_page: 2, chunk_size: 16 },
} as import("../../config.js").ClodPagesConfig;

const NON_EMPTY_CHUNK: ChunkMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  materials: new Float32Array([0, 0, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

const EMPTY_CHUNK: ChunkMesh = {
  positions: new Float32Array(),
  normals: new Float32Array(),
  materials: new Float32Array(),
  indices: new Uint32Array(),
};

function makeNode(
  id = "L0:1,1",
  footprint: PageFootprint = { minX: 16, maxX: 32, minZ: 16, maxZ: 32 },
  level = 0,
): ClodPageNode {
  return {
    id,
    level,
    footprint,
    mesh: {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 1, 0]),
      paintSlots: new Float32Array([0]),
      materialWeights: new Float32Array([1, 0, 0, 0]),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 0, 0]),
    },
  } as ClodPageNode;
}

function makeView(node: ClodPageNode, target = 1) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  return { node, mesh, fade: 1, target };
}

function makeMaterialController(): TerrainMaterialController {
  const sharedMaterial = {
    material: new THREE.MeshStandardMaterial(),
    setBaseColor: vi.fn(),
    onMaterialChanged: () => () => {},
  };
  return {
    sharedMaterial,
    materials: new Map(),
    makeTerrainMaterial: () => sharedMaterial,
    configureChunkMaterial: vi.fn(),
  } as unknown as TerrainMaterialController;
}

function makeController(options: {
  scene?: THREE.Scene;
  materialController?: TerrainMaterialController;
  getGpuMesher?: () => GpuChunkMesher | null;
  chunkGroupBuildBudget?: number;
  maxCachedChunkGroups?: number;
  evictDistanceMultiplier?: number;
  streamingLiveTerrain?: boolean;
  terrainColliders?: TerrainColliderSet | null;
} = {}) {
  return createNearFieldBubbleController({
    scene: options.scene ?? new THREE.Scene(),
    materialController: options.materialController ?? makeMaterialController(),
    cfg: TEST_CFG,
    worldBounds: { cellsX: 64, cellsZ: 64 },
    getTintBubble: () => false,
    getGpuMesher: options.getGpuMesher ?? (() => null),
    chunkGroupBuildBudget: options.chunkGroupBuildBudget ?? 4,
    maxCachedChunkGroups: options.maxCachedChunkGroups ?? 64,
    evictDistanceMultiplier: options.evictDistanceMultiplier ?? 2.5,
    streamingLiveTerrain: options.streamingLiveTerrain ?? false,
    terrainColliders: options.terrainColliders,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function runUpdateAndFlush(
  controller: ReturnType<typeof makeController>,
  input: Parameters<ReturnType<typeof makeController>["update"]>[0],
): Promise<ReturnType<ReturnType<typeof makeController>["update"]>> {
  const stats = controller.update(input);
  await flushPromises();
  return stats;
}

describe("requiredStreamingPageCoords", () => {
  it("keeps requesting live pages around a moving center outside the finite world", () => {
    const coords = requiredStreamingPageCoords(new THREE.Vector3(4096, 0, -2048), 96, 32);
    const keys = new Set(coords.map((c) => `${c.px},${c.pz}`));

    expect(coords.length).toBeGreaterThan(0);
    expect(keys.has("128,-64")).toBe(true);
  });

  it("reuses residency coordinates until the center crosses a page boundary", () => {
    const cache = createRequiredStreamingPageCoordCache();
    const first = cache.get(new THREE.Vector3(33, 0, 33), 96, 32);
    const samePage = cache.get(new THREE.Vector3(63.9, 0, 63.9), 96, 32);
    const nextPage = cache.get(new THREE.Vector3(64, 0, 64), 96, 32);

    expect(samePage).toBe(first);
    expect(nextPage).not.toBe(first);
    expect(first[0]).toMatchObject({ px: 1, pz: 1 });
    expect(nextPage[0]).toMatchObject({ px: 2, pz: 2 });
  });
});

describe("liveBubbleChunkFootprint", () => {
  it("maps page/chunk coordinates to world-space collider footprints", () => {
    expect(liveBubbleChunkFootprint(2, -1, 3, 1, 4, 16)).toEqual({
      minX: 176,
      minZ: -48,
      maxX: 192,
      maxZ: -32,
    });
  });
});

describe("liveBubbleOwnsPageView", () => {
  it("owns page views through the same half-diagonal rim used for chunk requests", () => {
    const pageSize = 32;
    const bubbleRadius = 100;
    const halfDiag = pageSize * Math.SQRT2 * 0.5;
    const center = new THREE.Vector3(0, 0, 0);
    const limit = bubbleRadius + halfDiag;
    const epsilon = 0.001;
    const insideRimNode = makeNode("L0:rim,0", {
      minX: limit - epsilon - pageSize / 2,
      maxX: limit - epsilon + pageSize / 2,
      minZ: -pageSize / 2,
      maxZ: pageSize / 2,
    });
    const outsideNode = makeNode("L0:outside,0", {
      minX: limit + epsilon - pageSize / 2,
      maxX: limit + epsilon + pageSize / 2,
      minZ: -pageSize / 2,
      maxZ: pageSize / 2,
    });

    expect(liveBubbleOwnsPageView(insideRimNode, center, bubbleRadius, pageSize, 1)).toBe(true);
    expect(liveBubbleOwnsPageView(outsideNode, center, bubbleRadius, pageSize, 1)).toBe(false);
    expect(liveBubbleOwnsPageView(makeNode("L1:rim,0", insideRimNode.footprint, 1), center, bubbleRadius, pageSize, 1)).toBe(false);
    expect(liveBubbleOwnsPageView(insideRimNode, center, bubbleRadius, pageSize, 0.5)).toBe(false);
  });
});

describe("createNearFieldBubbleController", () => {
  beforeEach(() => {
    terrainMocks.meshChunk.mockReset();
    terrainMocks.stepChunkMeshBuild.mockReset();
    terrainMocks.stepChunkMeshBuild.mockReturnValue(true);
    terrainMocks.meshChunk.mockImplementation((): ChunkMesh => {
      throw new Error("cpu fallback fail");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps welded page visible when GPU chunk meshing fails", async () => {
    const rejectMesher = {
      meshChunk: vi.fn(() => Promise.reject(new Error("gpu fail"))),
    };

    const controller = makeController({
      getGpuMesher: () => rejectMesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: false,
    });

    const node = makeNode();
    const view = makeView(node);
    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 1,
    });
    expect(rejectMesher.meshChunk).toHaveBeenCalledTimes(2);
    await flushPromises();
    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 2,
    });
    expect(rejectMesher.meshChunk).toHaveBeenCalledTimes(4);
    await flushPromises();

    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 3,
    });

    expect(view.mesh.visible).toBe(true);
    expect(controller.size()).toBe(1);
  });

  it("does not mark page failed when GPU returns empty but successful chunks", async () => {
    const emptyMesher = {
      meshChunk: vi.fn(() => Promise.resolve(EMPTY_CHUNK)),
    };

    const controller = makeController({
      getGpuMesher: () => emptyMesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: false,
    });

    const node = makeNode();
    const view = makeView(node);
    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 1,
    });
    expect(emptyMesher.meshChunk).toHaveBeenCalledTimes(2);
    await flushPromises();
    await runUpdateAndFlush(controller, {
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 2,
    });

    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 3,
    });

    expect(view.mesh.visible).toBe(true);
  });

  it("counts empty but finished required streaming pages as ready", async () => {
    const emptyMesher = {
      meshChunk: vi.fn(() => Promise.resolve(EMPTY_CHUNK)),
    };
    const controller = makeController({
      getGpuMesher: () => emptyMesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
    });

    controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });
    expect(emptyMesher.meshChunk).toHaveBeenCalledTimes(2);
    await flushPromises();
    await runUpdateAndFlush(controller, {
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 2,
    });
    await flushPromises();

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 3,
    });

    expect(stats.requiredPages).toBe(1);
    expect(stats.readyPages).toBe(1);
    expect(stats.validEmptyPages).toBe(1);
    expect(stats.buildingPages).toBe(0);
    expect(stats.failedPages).toBe(0);
  });

  it("prioritizes required streaming pages before render-view bubble pages", () => {
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      chunkGroupBuildBudget: 1,
      streamingLiveTerrain: true,
    });
    const farViewNode = makeNode("L0:3,3", { minX: 96, maxX: 128, minZ: 96, maxZ: 128 });

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 96,
      bubbleCenter: new THREE.Vector3(64, 0, 64),
      bubbleViews: [makeView(farViewNode)],
      getView: () => undefined,
      frameId: 1,
    });

    expect(stats.chunkGroupsBuiltThisFrame).toBe(1);
    expect(mesher.meshChunk).toHaveBeenCalledTimes(2);
    const firstCall = mesher.meshChunk.mock.calls[0] as unknown as [number, number];
    expect(firstCall[0]).toBe(4);
    expect(firstCall[1]).toBe(4);
  });

  it("does not enqueue all GPU chunks when a page is created", () => {
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
    });

    controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    expect(mesher.meshChunk).toHaveBeenCalledTimes(2);
  });

  it("accepts a query override for GPU chunk dispatch budget", () => {
    vi.stubGlobal("window", { location: { search: "?liveBubbleGpuChunkBudget=4" } });
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
    });

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    expect(mesher.meshChunk).toHaveBeenCalledTimes(4);
    expect(stats.gpuDispatchBudget).toBe(4);
  });

  it("caps live-bubble GPU chunk inflight work", () => {
    vi.stubGlobal("window", { location: { search: "?liveBubbleGpuChunkBudget=4&liveBubbleMaxInflightChunks=2" } });
    const mesher = {
      meshChunk: vi.fn(() => new Promise<ChunkMesh>(() => undefined)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
    });

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    expect(mesher.meshChunk).toHaveBeenCalledTimes(2);
    expect(stats.gpuDispatchBudget).toBe(4);
    expect(stats.gpuMaxInflightChunks).toBe(2);
    expect(stats.inflightChunks).toBe(2);
  });

  it("reports pending and inflight chunk counters while GPU work is building", () => {
    const mesher = {
      meshChunk: vi.fn(() => new Promise<ChunkMesh>(() => undefined)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
    });

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    expect(stats.pendingChunks).toBe(2);
    expect(stats.inflightChunks).toBe(2);
  });

  it("counts missing required streaming pages as building", () => {
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      chunkGroupBuildBudget: 1,
      streamingLiveTerrain: true,
    });

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 96,
      bubbleCenter: new THREE.Vector3(4096, 0, -2048),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    expect(stats.requiredPages).toBeGreaterThan(1);
    expect(stats.readyPages).toBe(0);
    expect(stats.buildingPages).toBe(stats.requiredPages);
  });

  it("waits for GPU instead of CPU meshing required streaming pages", () => {
    const controller = makeController({
      getGpuMesher: () => null,
      streamingLiveTerrain: true,
    });

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    expect(terrainMocks.meshChunk).not.toHaveBeenCalled();
    expect(stats.requiredPages).toBe(1);
    expect(stats.buildingPages).toBe(1);
    expect(stats.readyPages).toBe(0);
    expect(stats.failedPages).toBe(0);
  });

  it("promotes waiting streaming pages when the GPU mesher becomes available", () => {
    let mesher: { meshChunk: ReturnType<typeof vi.fn> } | null = null;
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher | null,
      streamingLiveTerrain: true,
    });

    controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });

    mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 2,
    });

    expect(terrainMocks.meshChunk).not.toHaveBeenCalled();
    expect(mesher.meshChunk).toHaveBeenCalledTimes(2);
  });

  it("keeps CPU fallback for non-streaming pages without a GPU mesher", () => {
    terrainMocks.meshChunk.mockImplementation(() => NON_EMPTY_CHUNK);
    const controller = makeController({
      getGpuMesher: () => null,
      streamingLiveTerrain: false,
    });
    const node = makeNode();
    const view = makeView(node);

    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 1,
    });

    expect(terrainMocks.meshChunk).toHaveBeenCalled();
  });

  it("resumes CPU fallback work before finalizing a chunk", () => {
    terrainMocks.meshChunk.mockImplementation(() => NON_EMPTY_CHUNK);
    terrainMocks.stepChunkMeshBuild.mockReturnValueOnce(false).mockReturnValue(true);
    const controller = makeController({ getGpuMesher: () => null, streamingLiveTerrain: false });
    const node = makeNode();
    const view = makeView(node);
    const input = {
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id: string) => (id === node.id ? view : undefined),
      frameId: 1,
    };

    controller.update(input);
    expect(terrainMocks.meshChunk).not.toHaveBeenCalled();
    controller.update({ ...input, frameId: 2 });
    expect(terrainMocks.meshChunk).toHaveBeenCalled();
  });

  it("counts streamed collider pages by page, not by chunk collider", async () => {
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const colliders = new Map<string, unknown>();
    const terrainColliders = {
      upsertPage: vi.fn((page: { id: string }) => {
        colliders.set(page.id, page);
      }),
      removePage: vi.fn((id: string) => colliders.delete(id)),
    } as unknown as TerrainColliderSet;
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
      terrainColliders,
    });

    controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    });
    expect(mesher.meshChunk).toHaveBeenCalledTimes(2);
    await flushPromises();
    await runUpdateAndFlush(controller, {
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 2,
    });
    await flushPromises();

    const stats = controller.update({
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 3,
    });

    expect(stats.readyPages).toBe(1);
    expect(stats.streamedColliderPages).toBe(1);
    expect(stats.colliderRegistrations).toBe(4);
  });

  it("lets visual pages outside the collider radius become ready without registering colliders", async () => {
    vi.stubGlobal("window", { location: { search: "?liveBubbleGpuChunkBudget=4&liveBubbleColliderRadius=1" } });
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const terrainColliders = {
      upsertPage: vi.fn(),
      removePage: vi.fn(() => true),
    } as unknown as TerrainColliderSet;
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: false,
      terrainColliders,
    });
    const node = makeNode("L0:10,10", { minX: 320, maxX: 352, minZ: 320, maxZ: 352 });
    const view = makeView(node);
    const input = {
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(0, 0, 0),
      bubbleViews: [view],
      getView: (id: string) => (id === node.id ? view : undefined),
      frameId: 1,
    };

    controller.update(input);
    await flushPromises();
    const stats = controller.update({ ...input, frameId: 2 });

    expect(controller.readyPageKeys()).toEqual([node.id]);
    expect(stats.colliderRegistrations).toBe(0);
    expect(terrainColliders.upsertPage).not.toHaveBeenCalled();
  });

  it("treats GPU-empty live pages as valid empty without CPU fallback", async () => {
    terrainMocks.meshChunk.mockImplementation(() => NON_EMPTY_CHUNK);
    const mesher = {
      meshChunk: vi.fn(() => Promise.resolve(EMPTY_CHUNK)),
    };
    const colliders = new Map<string, unknown>();
    const terrainColliders = {
      upsertPage: vi.fn((page: { id: string }) => {
        colliders.set(page.id, page);
      }),
      removePage: vi.fn((id: string) => colliders.delete(id)),
    } as unknown as TerrainColliderSet;
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher,
      streamingLiveTerrain: true,
      terrainColliders,
    });
    const input = {
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    };

    controller.update(input);
    await flushPromises();
    await runUpdateAndFlush(controller, { ...input, frameId: 2 });
    await flushPromises();
    const stats = controller.update({ ...input, frameId: 3 });

    expect(terrainMocks.meshChunk).not.toHaveBeenCalled();
    expect(stats.readyPages).toBe(1);
    expect(stats.validEmptyPages).toBe(1);
    expect(stats.failedPages).toBe(0);
    expect(stats.buildingPages).toBe(0);
    expect(stats.streamedColliderPages).toBe(0);
    expect(stats.colliderRegistrations).toBe(0);
  });

  it("returns stalled GPU pages to the wait queue when the mesher disappears", async () => {
    let mesher: { meshChunk: ReturnType<typeof vi.fn> } | null = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    const controller = makeController({
      getGpuMesher: () => mesher as unknown as GpuChunkMesher | null,
      streamingLiveTerrain: true,
    });
    const input = {
      enabled: true,
      bubbleRadius: 1,
      bubbleCenter: new THREE.Vector3(48, 0, 48),
      bubbleViews: [],
      getView: () => undefined,
      frameId: 1,
    };

    controller.update(input);
    mesher = null;
    const waiting = controller.update({ ...input, frameId: 2 });
    expect(waiting.buildingPages).toBe(1);

    mesher = {
      meshChunk: vi.fn(() => Promise.resolve(NON_EMPTY_CHUNK)),
    };
    controller.update({ ...input, frameId: 3 });
    expect(mesher.meshChunk).toHaveBeenCalled();
  });
});
