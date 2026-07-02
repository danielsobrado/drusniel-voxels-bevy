import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { TerrainColorAdjustments } from "../../material/material.js";
import type { TerrainMaterialUiState } from "../material/terrain_material_controller.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import { ClodRenderNodeCache } from "./clod_render_node_cache.js";
import type { ClodRenderNodeCacheDeps } from "./clod_render_node_cache.js";

function mesh(seed = 0): PageMesh {
  return {
    positions: new Float32Array([
      seed, 0, 0,
      seed + 1, 0, 0,
      seed, 0, 1,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ]),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function node(id = "L0:0,0", pageMesh = mesh()): ClodPageNode {
  return {
    id,
    revision: 1,
    level: 0,
    children: [],
    mesh: pageMesh,
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function materialState(): TerrainMaterialUiState {
  return {
    terrainMaterialSource: "debug_flat",
    albedo: false,
    triplanar: true,
    normalMap: false,
    proceduralMicroNormals: false,
    normalIntensity: 1,
    roughness: 0.8,
    metalness: 0,
    textureScale: 1,
    textureBlendMode: "blend bands",
    textureBlendWidth: 0.15,
    proceduralDebugMode: "final",
    colorByLod: false,
    wireframe: false,
    clodPerfMode: false,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 1,
    frontSideOnly: false,
    tintBubble: false,
  };
}

function colorAdjustments(): TerrainColorAdjustments {
  return { brightness: 1, contrast: 1, saturation: 1, warmth: 0 };
}

function materialHandle() {
  const material = new THREE.MeshBasicMaterial();
  const unsubscribe = vi.fn();
  return {
    material,
    unsubscribe,
    handle: {
      material,
      onMaterialChanged: vi.fn(() => unsubscribe),
      setBaseColor: vi.fn(),
      setColorAdjust: vi.fn(),
      setLighting: vi.fn(),
      setTextures: vi.fn(),
      setDebug: vi.fn(),
      setTriplanar: vi.fn(),
      setSide: vi.fn(),
      setWireframe: vi.fn(),
      setFade: vi.fn(),
      setTier: vi.fn(),
    },
  };
}

function deps(overrides: Partial<ClodRenderNodeCacheDeps> = {}) {
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const madeMaterials = new Set<ReturnType<typeof materialHandle>["handle"]>();
  const pageGeometryCache = {
    getOrCreate: vi.fn(() => geometry),
    setGeometryActive: vi.fn(),
    invalidateNode: vi.fn(),
    owns: vi.fn(() => true),
  };
  const materialController = {
    sharedMaterial: null,
    materials: madeMaterials,
    makeTerrainMaterial: vi.fn(() => {
      const made = materialHandle();
      madeMaterials.add(made.handle);
      return made.handle;
    }),
    applyLighting: vi.fn(),
    activeTerrainSlots: vi.fn(() => []),
    terrainTextureUniformOptions: vi.fn(() => ({})),
  };
  const base: ClodRenderNodeCacheDeps = {
    scene,
    materialController: materialController as unknown as ClodRenderNodeCacheDeps["materialController"],
    pageGeometryCache: pageGeometryCache as unknown as ClodRenderNodeCacheDeps["pageGeometryCache"],
    getMaterialColorForNode: vi.fn(() => 0xb9c0c8),
    getColorAdjustments: vi.fn(colorAdjustments),
    getLighting: vi.fn(() => ({
      sunDirection: new THREE.Vector3(1, 1, 1),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(1, 1, 1),
      groundLight: new THREE.Color(1, 1, 1),
    })),
    getMaterialState: vi.fn(materialState),
    getNormalMode: vi.fn(() => "source"),
    config: {
      enabled: true,
      maxInactiveNodes: 0,
      pruneIntervalFrames: 1,
      prefetchParent: true,
      prefetchChildren: false,
      maxPrefetchCreatesPerFrame: 2,
      warnAtInactiveNodes: 999,
      evictGeometryWithRenderNode: true,
    },
  };
  return {
    deps: { ...base, ...overrides },
    scene,
    geometry,
    pageGeometryCache,
    materialController,
  };
}

describe("ClodRenderNodeCache", () => {
  it("materializes views lazily and reuses existing views", () => {
    const setup = deps();
    const cache = new ClodRenderNodeCache(setup.deps);
    const n = node();

    expect(cache.views().size).toBe(0);
    const first = cache.getOrCreate({ node: n, frameId: 1 });
    const second = cache.getOrCreate({ node: n, frameId: 2 });

    expect(second).toBe(first);
    expect(setup.scene.children).toContain(first.mesh);
    expect(setup.pageGeometryCache.getOrCreate).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ materializedNodes: 1, creates: 1, reuses: 1 });
    cache.dispose();
  });

  it("prefetch respects the per-frame create budget", () => {
    const setup = deps();
    const cache = new ClodRenderNodeCache(setup.deps);

    cache.prefetch([
      node("L0:0,0"),
      node("L0:1,0", mesh(10)),
      node("L0:2,0", mesh(20)),
    ], 1);

    expect(cache.stats()).toMatchObject({ materializedNodes: 2, prefetches: 2 });
    cache.dispose();
  });

  it("prunes inactive nodes and releases cache-owned geometry", () => {
    const setup = deps();
    const cache = new ClodRenderNodeCache(setup.deps);
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), frameId: 2 });

    cache.prune(new Set(), 3);

    expect(cache.stats()).toMatchObject({ materializedNodes: 0, disposals: 2, evictions: 2 });
    expect(setup.pageGeometryCache.setGeometryActive).toHaveBeenCalledWith(setup.geometry, false);
    expect(setup.pageGeometryCache.invalidateNode).toHaveBeenCalledWith("L0:0,0", { includeActive: true });
    expect(setup.pageGeometryCache.invalidateNode).toHaveBeenCalledWith("L0:1,0", { includeActive: true });
  });

  it("keeps active nodes during prune", () => {
    const setup = deps();
    const cache = new ClodRenderNodeCache(setup.deps);
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), frameId: 2 });
    cache.markActive(new Set(["L0:0,0"]), 3);

    cache.prune(new Set(["L0:0,0"]), 4);

    expect(cache.get("L0:0,0")).toBeDefined();
    expect(cache.get("L0:1,0")).toBeUndefined();
    expect(cache.stats()).toMatchObject({ materializedNodes: 1, activeNodes: 1, disposals: 1 });
    cache.dispose();
  });

  it("dispose removes all views from the scene", () => {
    const setup = deps();
    const cache = new ClodRenderNodeCache(setup.deps);
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), frameId: 2 });

    cache.dispose();

    expect(cache.views().size).toBe(0);
    expect(setup.scene.children.length).toBe(0);
    expect(cache.stats()).toMatchObject({ disposals: 2 });
  });
});
