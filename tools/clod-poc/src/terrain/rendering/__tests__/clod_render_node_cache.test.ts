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
    forEachMaterial: (fn) => {
      for (const mat of materials) fn(mat);
    },
    applyLighting,
    applyColorAdjustments: vi.fn(),
    activeTerrainSlots: () => [],
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
  pageGeometryCache: PageGeometryCache;
} {
  const scene = options.scene ?? new THREE.Scene();
  const material = fakeMaterialController();
  const pageGeometryCache = options.pageGeometryCache
    ?? new PageGeometryCache({ enabled: false, maxEntries: 8, warnAtEntries: 8 });
  return {
    cache: new ClodRenderNodeCache({
      scene,
      materialController: options.materialController ?? material.controller,
      pageGeometryCache,
      getMaterialColorForNode: () => 0xb9c0c8,
      getColorAdjustments: adjustments,
      getLighting: lighting,
      getMaterialState: options.getMaterialState ?? materialState,
      getNormalMode: () => "source",
      config: defaultConfig(options.config),
    }),
    scene,
    material,
    pageGeometryCache,
  };
}

describe("ClodRenderNodeCache", () => {
  it("does not create nodes at construction", () => {
    const { cache, scene, material } = makeCache();

    expect(cache.stats().materializedNodes).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(material.makeTerrainMaterial).not.toHaveBeenCalled();
  });

  it("creates render node on getOrCreate", () => {
    const { cache, scene } = makeCache();
    const add = vi.spyOn(scene, "add");

    const view = cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });

    expect(add).toHaveBeenCalledTimes(1);
    expect(cache.get("L0:0,0")).toBe(view);
    expect(view.mesh.visible).toBe(false);
    expect(cache.stats()).toMatchObject({ materializedNodes: 1, creates: 1 });
  });

  it("reuses existing render node", () => {
    const { cache } = makeCache();
    const n = node("L0:0,0");

    const first = cache.getOrCreate({ node: n, frameId: 1 });
    const second = cache.getOrCreate({ node: n, frameId: 2 });

    expect(second).toBe(first);
    expect(second.lastUsedFrame).toBe(2);
    expect(cache.stats()).toMatchObject({ creates: 1, reuses: 1 });
  });

  it("does not dispose protected active node", () => {
    const { cache } = makeCache({ config: { maxInactiveNodes: 0 } });

    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0", 0, mesh(10)), frameId: 2 });
    cache.prune(new Set(["L0:0,0"]), 10);

    expect(cache.has("L0:0,0")).toBe(true);
    expect(cache.has("L0:1,0")).toBe(false);
  });

  it("evicts least recently used inactive node", () => {
    const { cache } = makeCache({ config: { maxInactiveNodes: 2 } });

    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    const b = node("L0:1,0", 0, mesh(10));
    cache.getOrCreate({ node: b, frameId: 2 });
    cache.getOrCreate({ node: node("L0:2,0", 0, mesh(20)), frameId: 3 });
    cache.getOrCreate({ node: b, frameId: 4 });
    cache.prune(new Set(), 10);

    expect(cache.has("L0:0,0")).toBe(false);
    expect(cache.has("L0:1,0")).toBe(true);
    expect(cache.has("L0:2,0")).toBe(true);
    expect(cache.stats()).toMatchObject({ evictions: 1 });
  });

  it("evicts cache-owned geometry with evicted render nodes", () => {
    const pageGeometryCache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const { cache } = makeCache({ pageGeometryCache, config: { maxInactiveNodes: 0, evictGeometryWithRenderNode: true } });

    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    expect(pageGeometryCache.stats().entries).toBe(1);

    cache.prune(new Set(), 10);

    expect(cache.has("L0:0,0")).toBe(false);
    expect(pageGeometryCache.stats()).toMatchObject({ entries: 0, invalidations: 1, disposals: 1 });
  });

  it("disposeNode removes mesh from scene and disposes owned material and direct geometry", () => {
    const { cache, scene, material } = makeCache();
    const remove = vi.spyOn(scene, "remove");
    const view = cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    const geometryDispose = vi.spyOn(view.mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(material.handles[0].material, "dispose");

    cache.disposeNode("L0:0,0");

    expect(remove).toHaveBeenCalledWith(view.mesh);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(cache.has("L0:0,0")).toBe(false);
  });

  it("invalidateNode disposes only that node", () => {
    const { cache } = makeCache();

    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    cache.getOrCreate({ node: node("L0:1,0", 0, mesh(10)), frameId: 2 });
    cache.invalidateNode("L0:0,0");

    expect(cache.has("L0:0,0")).toBe(false);
    expect(cache.has("L0:1,0")).toBe(true);
  });

  it("newly materialized node receives current material state", () => {
    const { cache, material } = makeCache({
      getMaterialState: () => ({
        ...materialState(),
        triplanar: true,
        frontSideOnly: true,
        normalColor: true,
        wireframe: true,
      }),
    });

    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });
    const handle = material.handles[0];

    expect(material.makeTerrainMaterial).toHaveBeenCalledTimes(1);
    expect(handle.setColorAdjust).toHaveBeenCalledWith(adjustments());
    expect(material.applyLighting).toHaveBeenCalledTimes(1);
    expect(handle.setWireframe).toHaveBeenCalledWith(true);
    expect(handle.setTriplanar).toHaveBeenCalledWith(true);
    expect(handle.setSide).toHaveBeenCalledWith(THREE.FrontSide);
    expect(handle.setTextures).toHaveBeenCalledTimes(1);
  });

  it("disabled cache creates all nodes only through explicit getOrCreate, not constructor", () => {
    const { cache, scene } = makeCache({ config: { enabled: false } });

    expect(cache.stats().materializedNodes).toBe(0);
    expect(scene.children).toHaveLength(0);
    cache.getOrCreate({ node: node("L0:0,0"), frameId: 1 });

    expect(cache.stats()).toMatchObject({ enabled: false, materializedNodes: 1 });
  });
});
