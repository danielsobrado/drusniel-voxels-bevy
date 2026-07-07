import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { ClodRuntimeConfig } from "../../../app/runtime_config.js";
import type { ClodPageNode, PageMesh } from "../../../types.js";
import { LockedBorderOverlay } from "../../../ui/locked_border_overlay.js";
import { DEFAULT_PAGE_GEOMETRY_CACHE_CONFIG } from "../../geometry/page_geometry_cache.js";
import { DEFAULT_CLOD_RENDER_NODE_CACHE_CONFIG } from "../../rendering/clod_render_node_cache_config.js";
import { DEFAULT_CLOD_APPLY_BUDGET } from "../../rendering/clod_apply_queue.js";
import { DEFAULT_SELECTION_CUT_CACHE_CONFIG } from "../selection_cut_cache.js";
import { DEFAULT_MATERIAL_CHURN_CONFIG } from "../../../rendering/material_churn/material_churn_diagnostics.js";
import { DEFAULT_RENDER_RESOLUTION_CONFIG } from "../../../rendering/render_resolution_config.js";
import { createClodSelectionController, type ClodSelectionTerrainView } from "../clod_selection_controller.js";

function runtimeConfig(): ClodRuntimeConfig {
  return {
    runtime: { worldOptions: [2] },
    webgpuSelection: {
      errorMaxAgeFrames: 6,
      dispatchIntervalFrames: 2,
      parityIntervalFrames: 60,
      errorTolerancePx: 0.02,
    },
    terrainTextures: { textureArraySize: 512 },
    nearField: {
      chunkGroupBuildBudget: 1,
      maxCachedChunkGroups: 64,
      evictDistanceMultiplier: 2.5,
    },
    pageGeometryCache: DEFAULT_PAGE_GEOMETRY_CACHE_CONFIG,
    renderNodeCache: DEFAULT_CLOD_RENDER_NODE_CACHE_CONFIG,
    clodApply: DEFAULT_CLOD_APPLY_BUDGET,
    selectionCutCache: DEFAULT_SELECTION_CUT_CACHE_CONFIG,
    materialChurn: DEFAULT_MATERIAL_CHURN_CONFIG,
    renderResolution: DEFAULT_RENDER_RESOLUTION_CONFIG,
    digging: { holdIntervalMs: 400 },
    profiling: { slowFrameMs: 24 },
    stats: { normalHz: 4, debugHz: 10, profileEveryFrame: true },
  };
}

function mesh(): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function node(): ClodPageNode {
  return {
    id: "L0:0,0",
    revision: 1,
    level: 0,
    children: [],
    mesh: mesh(),
    footprint: { minX: 0, minZ: 0, maxX: 16, maxZ: 16 },
    bounds: { center: [8, 0, 8], radius: 12, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function terrainView(n: ClodPageNode): ClodSelectionTerrainView {
  return {
    node: n,
    selected: false,
    fade: 0,
    target: 0,
    mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
    mat: {
      setTier: vi.fn(),
      setFade: vi.fn(),
      setRootMorph: vi.fn(),
    },
  };
}

describe("createClodSelectionController cache hits", () => {
  it("refreshes active render-node state and prefetches when reusing a cached cut", () => {
    const root = node();
    const views = new Map<string, ClodSelectionTerrainView>();
    const markActiveNodes = vi.fn();
    const prefetchNodes = vi.fn();
    const getOrCreateView = vi.fn((n: ClodPageNode) => {
      let view = views.get(n.id);
      if (!view) {
        view = terrainView(n);
        views.set(n.id, view);
      }
      return view;
    });
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(32, 32, 32);
    camera.lookAt(0, 0, 0);
    const overlayScene = new THREE.Scene();
    const lockedBorderOverlay = new LockedBorderOverlay(overlayScene);

    const controller = createClodSelectionController({
      config: {
        clodRuntime: runtimeConfig(),
        hysteresisMergeFactor: 1.5,
        chunksPerPage: 2,
        chunkSize: 16,
        readbackMode: "off",
        forceContinuousParity: false,
        webGpuUnavailableReason: null,
        poolTerrainMaterial: false,
      },
      roots: [root],
      allNodes: [root],
      views,
      getOrCreateView,
      markActiveNodes,
      prefetchNodes,
      getClodErrorCompute: () => null,
      getSettings: () => ({
        thresholdPx: 1,
        enforce21: true,
        freezeSelection: false,
        neighborLevelDeltaMax: 1,
        bubble: false,
        bubbleRadius: 64,
        forceMaxLevel: "auto",
        webgpuSelection: false,
        showBounds: false,
        showSeamPoints: false,
        showCrossLodBorders: false,
        showLockedBorderVertices: false,
        materialTiers: false,
      }),
      getSelectionCenter: () => new THREE.Vector3(8, 0, 8),
      renderer: { domElement: { height: 720 } as HTMLCanvasElement },
      camera,
      overlays: {
        boundaryGroup: new THREE.Group(),
        seamGroup: new THREE.Group(),
        crossLodBorderGroup: new THREE.Group(),
      },
      lockedBorderOverlay,
      staleEditedAncestorIds: new Set<string>(),
      onCutChanged: vi.fn(),
    });

    controller.update();
    controller.advanceFrame();
    controller.update();

    expect(controller.stats().selectionCache.hits).toBe(1);
    expect(getOrCreateView).toHaveBeenCalledTimes(1);
    expect(markActiveNodes).toHaveBeenCalledTimes(2);
    expect(prefetchNodes).toHaveBeenCalledTimes(1);
    expect([...views.values()][0].selected).toBe(true);
    expect([...views.values()][0].target).toBe(1);

    lockedBorderOverlay.dispose();
  });
});
