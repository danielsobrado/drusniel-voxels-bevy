import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentLighting } from "../../../environment/environment.js";
import type { TerrainColorAdjustments } from "../../../material/material.js";
import type { TerrainMaterialHandle } from "../../../rendering/terrain_material.js";
import type {
  TerrainMaterialController,
  TerrainMaterialUiState,
} from "../../material/terrain_material_controller.js";
import { PageGeometryCache } from "../../geometry/page_geometry_cache.js";
import type { ClodPageNode, PageMesh } from "../../../types.js";
import { ClodRenderNodeCache } from "../clod_render_node_cache.js";
import type { ClodRenderNodeCacheConfig } from "../clod_render_node_cache_config.js";

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

function node(id: string, level = 0, pageMesh = mesh()): ClodPageNode {
  return {
    id,
    level,
    children: [],
    mesh: pageMesh,
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

const defaultConfig = (overrides: Partial<ClodRenderNodeCacheConfig> = {}): ClodRenderNodeCacheConfig => ({
  enabled: true,
  maxInactiveNodes: 8,
  pruneIntervalFrames: 1,
  prefetchParent: false,
  prefetchChildren: false,
  maxPrefetchCreatesPerFrame: 8,
  warnAtInactiveNodes: 999,
  evictGeometryWithRenderNode: true,
  ...overrides,
});

const lighting = (): EnvironmentLighting => ({
  sunDirection: new THREE.Vector3(0, 1, 0),
  sunColor: new THREE.Color(1, 1, 1),
  skyLight: new THREE.Color(1, 1, 1),
  groundLight: new THREE.Color(0.2, 0.2, 0.2),
});

const adjustments = (): TerrainColorAdjustments => ({
  brightness: 1,
  contrast: 1,
  saturation: 1,
  warmth: 0,
});

const materialState = (): TerrainMaterialUiState => ({
  terrainMaterialSource: "debug_flat",
  albedo: false,
  triplanar: false,
  normalMap: false,
  proceduralMicroNormals: false,
  normalIntensity: 1,
  roughness: 1,
  metalness: 0,
  textureScale: 1,
  textureBlendMode: "hard bands",
  textureBlendWidth: 1,
  proceduralDebugMode: "final",
  colorByLod: false,
  wireframe: false,
  clodPerfMode: false,
  normalColor: false,
  normalDivergence: false,
  divergenceGain: 1,
  frontSideOnly: false,
  tintBubble: false,
});

interface FakeMaterialController {
  controller: TerrainMaterialController;
  makeTerrainMaterial: ReturnType<typeof vi.fn>;
  applyLighting: ReturnType<typeof vi.fn>;
  handles: TerrainMaterialHandle[];
}

function fakeMaterialController(): FakeMaterialController {
  const handles: TerrainMaterialHandle[] = [];
  const makeTerrainMaterial = vi.fn((color: number): TerrainMaterialHandle => {
    const material = new THREE.MeshBasicMaterial({ color });
    const handle: TerrainMaterialHandle = {
      material,
      onMaterialChanged: vi.fn(() => vi.fn()),
      setBaseColor: vi.fn(),
      setColorAdjust: vi.fn(),
      setLighting: vi.fn(),
      setTextures: vi.fn(),
      setDebug: vi.fn(),
      setTriplanar: vi.fn(),
      setSide: vi.fn(),
      setWireframe: vi.fn(),
      setFade: vi.fn(),
      setRootMorph: vi.fn(),
      setTier: vi.fn(),
    };
    handles.push(handle);
    return handle;
  });
  const applyLighting = vi.fn((mat: TerrainMaterialHandle, value: EnvironmentLighting) => {
    mat.setLighting(value);
  });
  const materials = new Set<TerrainMaterialHandle>();
  const controller: TerrainMaterialController = {
    materials,
    makeTerrainMaterial: (color) => {
      const handle = makeTerrainMaterial(color);
      materials.add(handle);
      return handle;
    },
    // Declining keeps the pre-pool dispose behavior these tests assert on.
    releaseTerrainMaterial: (handle) => {
      materials.delete(handle);
      return false;
    },
    ensureRecycleReserve: () => true,
    forEachMaterial: (fn) => {
      for (const mat of materials) fn(mat);
    },
    applyLighting,
    applyColorAdjustments: vi.fn(),
    activeTerrainSlots: () => [],
    availableTerrainSlots: () => [],
    texturesActive: () => false,
    terrainTextureUniformOptions: () => ({
      enabled: false,
      triplanar: false,
      normalMap: false,
      normalIntensity: 1,
      roughness: 1,
      metalness: 0,
      textureScale: 1,
      blendBands: false,
      blendWidth: 1,
      painted: false,
      albedoArray: null,
      normalArray: null,
    }),
    applyTerrainTextures: vi.fn(),
    setProceduralTerrain: vi.fn(),
    setRiverTerrainWetnessMask: vi.fn(),
    applyColorByLodToMaterials: vi.fn(),
    syncColorByLod: vi.fn(),
    configureChunkMaterial: vi.fn(),
    diagnostics: vi.fn(() => {
      throw new Error("terrain diagnostics are not used by this test double");
    }),
    sharedMaterial: null,
  };
  return { controller, makeTerrainMaterial, applyLighting, handles };
}

function makeCache(options: {
  scene?: THREE.Scene;
  materialController?: TerrainMaterialController;
  pageGeometryCache?: PageGeometryCache;
  config?: Partial<ClodRenderNodeCacheConfig>;
  getMaterialState?: () => TerrainMaterialUiState;
} = {}): {
  cache: ClodRenderNodeCache;
  scene: THREE.Scene;
  material: FakeMaterialController;
} {
  const scene = options.scene ?? new THREE.Scene();
  const material = fakeMaterialController();
  const cache = new ClodRenderNodeCache({
    scene,
    materialController: options.materialController ?? material.controller,
    pageGeometryCache: options.pageGeometryCache ?? new PageGeometryCache({ enabled: true, maxEntries: 32, warnAtEntries: 999 }),
    config: defaultConfig(options.config),
    getMaterialState: options.getMaterialState ?? materialState,
    getColorAdjustments: adjustments,
    getLighting: lighting,
    getMaterialColorForNode: () => 0xff0000,
    getNormalMode: () => "source",
  });
  return { cache, scene, material };
}

describe("ClodRenderNodeCache", () => {
  it("reuses active render nodes", () => {
    const { cache, material } = makeCache();
    // Same page mesh across frames: the geometry is unchanged, so the view must be reused.
    const pageMesh = mesh();
    const viewA = cache.getOrCreate({ node: node("L0:0,0", 0, pageMesh), frameId: 1 });
    const viewB = cache.getOrCreate({ node: node("L0:0,0", 0, pageMesh), frameId: 2 });

    expect(viewB).toBe(viewA);
    expect(viewB.lastUsedFrame).toBe(2);
    expect(material.makeTerrainMaterial).toHaveBeenCalledTimes(1);
  });

  it("refreshes the render node when its page mesh is replaced", () => {
    const { cache, material } = makeCache();
    const viewA = cache.getOrCreate({ node: node("L0:0,0", 0, mesh()), frameId: 1 });
    const viewB = cache.getOrCreate({ node: node("L0:0,0", 0, mesh()), frameId: 2 });

    // A replaced mesh must not reuse the previous view, or the node renders stale geometry.
    expect(viewB).not.toBe(viewA);
    expect(material.makeTerrainMaterial).toHaveBeenCalledTimes(2);
  });

  it("evicts inactive render nodes on prune", () => {
    const { cache, scene } = makeCache({ config: { maxInactiveNodes: 0 } });
    const viewA = cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0"), frameId: 2 });

    cache.prune(new Set(["L0:1,0"]), 3);

    expect(scene.children).not.toContain(viewA.mesh);
    expect(cache.stats().evictions).toBe(1);
  });

  it("does not dispose cached geometry on render node eviction when configured", () => {
    const geometryCache = new PageGeometryCache({ enabled: true, maxEntries: 32, warnAtEntries: 999 });
    const { cache } = makeCache({
      pageGeometryCache: geometryCache,
      config: { maxInactiveNodes: 0, evictGeometryWithRenderNode: false },
    });
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0"), frameId: 2 });

    cache.prune(new Set(["L0:1,0"]), 3);

    expect(geometryCache.has("L0:0,0")).toBe(true);
  });

  it("disposes cached geometry on render node eviction when configured", () => {
    const geometryCache = new PageGeometryCache({ enabled: true, maxEntries: 32, warnAtEntries: 999 });
    const { cache } = makeCache({
      pageGeometryCache: geometryCache,
      config: { maxInactiveNodes: 0, evictGeometryWithRenderNode: true },
    });
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0"), frameId: 2 });

    cache.prune(new Set(["L0:1,0"]), 3);

    expect(geometryCache.has("L0:0,0")).toBe(false);
  });

  it("clears render nodes and geometry cache entries", () => {
    const geometryCache = new PageGeometryCache({ enabled: true, maxEntries: 32, warnAtEntries: 999 });
    const { cache } = makeCache({ pageGeometryCache: geometryCache });
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });

    cache.clear();

    expect(cache.size).toBe(0);
    expect(geometryCache.size).toBe(0);
  });
});
