import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createNearFieldBubbleController } from "./near_field_bubble_controller.js";
import type { ClodPageNode } from "../types.js";

vi.mock("../terrain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../terrain.js")>();
  return {
    ...actual,
    meshChunk: () => {
      throw new Error("cpu fallback fail");
    },
  };
});

const TEST_CFG = {
  page: { chunks_per_page: 2, chunk_size: 16 },
} as import("../config.js").ClodPagesConfig;

function makeNode(id = "L0:1,1"): ClodPageNode {
  return {
    id,
    level: 0,
    footprint: { minX: 16, maxX: 32, minZ: 16, maxZ: 32 },
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

describe("createNearFieldBubbleController", () => {
  it("keeps welded page visible when GPU chunk meshing fails", async () => {
    const scene = new THREE.Scene();
    const sharedMaterial = {
      material: new THREE.MeshStandardMaterial(),
      setBaseColor: vi.fn(),
      onMaterialChanged: () => () => {},
    };
    const materialController = {
      sharedMaterial,
      materials: new Map(),
      makeTerrainMaterial: () => sharedMaterial,
      configureChunkMaterial: vi.fn(),
    } as unknown as import("./terrain_material_controller.js").TerrainMaterialController;

    const rejectMesher = {
      meshChunk: vi.fn(() => Promise.reject(new Error("gpu fail"))),
    };

    const controller = createNearFieldBubbleController({
      scene,
      materialController,
      cfg: TEST_CFG,
      worldBounds: { cellsX: 64, cellsZ: 64 },
      getTintBubble: () => false,
      getGpuMesher: () => rejectMesher as unknown as import("../gpu/gpu_chunk_mesher.js").GpuChunkMesher,
      chunkGroupBuildBudget: 4,
      maxCachedChunkGroups: 64,
      evictDistanceMultiplier: 2.5,
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
    await vi.waitFor(() => {
      expect(rejectMesher.meshChunk).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 2,
    });

    expect(view.mesh.visible).toBe(true);
    expect(controller.size()).toBe(1);
  });

  it("does not mark page failed when GPU returns empty but successful chunks", async () => {
    const scene = new THREE.Scene();
    const sharedMaterial = {
      material: new THREE.MeshStandardMaterial(),
      setBaseColor: vi.fn(),
      onMaterialChanged: () => () => {},
    };
    const materialController = {
      sharedMaterial,
      materials: new Map(),
      makeTerrainMaterial: () => sharedMaterial,
      configureChunkMaterial: vi.fn(),
    } as unknown as import("./terrain_material_controller.js").TerrainMaterialController;

    const emptyMesher = {
      meshChunk: vi.fn(() => Promise.resolve({
        positions: new Float32Array(),
        normals: new Float32Array(),
        materials: new Float32Array(),
        indices: new Uint32Array(),
      })),
    };

    const controller = createNearFieldBubbleController({
      scene,
      materialController,
      cfg: TEST_CFG,
      worldBounds: { cellsX: 64, cellsZ: 64 },
      getTintBubble: () => false,
      getGpuMesher: () => emptyMesher as unknown as import("../gpu/gpu_chunk_mesher.js").GpuChunkMesher,
      chunkGroupBuildBudget: 4,
      maxCachedChunkGroups: 64,
      evictDistanceMultiplier: 2.5,
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
    await vi.waitFor(() => {
      expect(emptyMesher.meshChunk).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.update({
      enabled: true,
      bubbleRadius: 1000,
      bubbleCenter: new THREE.Vector3(24, 0, 24),
      bubbleViews: [view],
      getView: (id) => (id === node.id ? view : undefined),
      frameId: 2,
    });

    expect(view.mesh.visible).toBe(true);
  });
});
