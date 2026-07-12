import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WaterClipmap } from "./waterClipmap.js";
import { WaterField } from "./waterField.js";
import { HydrologySystem } from "./hydrologySystem.js";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { parseWaterConfig, resolveWaterConfig } from "./water_config_parsing.js";
import type { TerrainHeightSampler } from "./water_field_types.js";
import type { WaterMaterialHandle, WaterMaterialParams, WaterStaticGridParams } from "./water_material_types.js";

const WORLD_CELLS = 512;
const CELLS_PER_LEVEL = 8;
const VERTS = CELLS_PER_LEVEL + 1;
const CELL_SIZE = 2;

// Same terrain as the legacy toroidal gold test.
const sampler: TerrainHeightSampler = {
  surfaceHeight: (x: number, z: number) =>
    24 + Math.sin(x * 0.004) * 14 + Math.cos(z * 0.0031) * 11 + Math.sin((x + z) * 0.0012) * 6,
};

function buildField(): WaterField {
  const config = resolveWaterConfig(parseWaterConfig("water:\n  enabled: true\n", () => {}), WORLD_CELLS);
  const hydroConfig = cloneHydrologyConfig();
  hydroConfig.simRes = 64;
  hydroConfig.accumulation.particles = 4000;
  hydroConfig.accumulation.maxSteps = 60;
  hydroConfig.fill.iterations = 60;
  const hydrology = HydrologySystem.build(hydroConfig, WORLD_CELLS, sampler, { infiniteWorldSamples: true });
  return new WaterField(config, sampler, hydrology, WORLD_CELLS);
}

interface StaticCapture {
  grid: WaterStaticGridParams | null;
  origins: Array<{ originMinX: number; originMinZ: number; baseSlotX: number; baseSlotZ: number }>;
}

/** Material mock that consumes params.staticGrid the way the TSL materials do. */
function makeStaticMaterialFactory(capture: StaticCapture) {
  return (params: WaterMaterialParams): WaterMaterialHandle => {
    capture.grid = params.staticGrid ?? null;
    return {
      material: new THREE.MeshBasicMaterial(),
      ...(params.staticGrid
        ? {
            staticGrid: {
              setOrigin: (originMinX: number, originMinZ: number, baseSlotX: number, baseSlotZ: number) => {
                capture.origins.push({ originMinX, originMinZ, baseSlotX, baseSlotZ });
              },
            },
          }
        : {}),
      setTime: () => {},
      setDebugMode: () => {},
      setInnerRect: () => {},
      setLevelId: () => {},
      setClipmapTint: () => {},
      setWireframe: () => {},
      updateCamera: () => {},
      updateSunDirection: () => {},
      updateVisual: () => {},
      dispose: () => {},
    };
  };
}

function buildStaticClipmap(field: WaterField, scene: THREE.Scene, capture: StaticCapture): WaterClipmap {
  const config = resolveWaterConfig(parseWaterConfig("water:\n  enabled: true\n", () => {}), WORLD_CELLS);
  config.cellSizes = [CELL_SIZE];
  config.cellsPerLevel = CELLS_PER_LEVEL;
  config.snapCells = 1;
  return new WaterClipmap({
    scene,
    config,
    field,
    createMaterial: makeStaticMaterialFactory(capture),
    sunDirection: new THREE.Vector3(0, 1, 0),
    cameraPosition: new THREE.Vector3(),
    worldBounds: { cellsX: 0, cellsZ: 0 },
    staticTopology: true,
  });
}

function torusSlot(worldIndex: number, verts: number): number {
  return ((worldIndex % verts) + verts) % verts;
}

/** Texels keyed by world vertex, reconstructed from the last setOrigin call. */
function texelSnapshot(capture: StaticCapture): Map<string, number[]> {
  const grid = capture.grid!;
  const origin = capture.origins[capture.origins.length - 1]!;
  const baseCol = Math.round(origin.originMinX / CELL_SIZE);
  const baseRow = Math.round(origin.originMinZ / CELL_SIZE);
  const dataA = grid.texelsA.image.data as Float32Array;
  const dataB = grid.texelsB.image.data as Float32Array;
  const out = new Map<string, number[]>();
  for (let j = 0; j <= CELLS_PER_LEVEL; j++) {
    for (let i = 0; i <= CELLS_PER_LEVEL; i++) {
      const slot = torusSlot(baseRow + j, VERTS) * VERTS + torusSlot(baseCol + i, VERTS);
      out.set(`${(baseCol + i) * CELL_SIZE},${(baseRow + j) * CELL_SIZE}`, [
        dataA[slot * 4], dataA[slot * 4 + 1], dataA[slot * 4 + 2], dataA[slot * 4 + 3],
        dataB[slot * 4], dataB[slot * 4 + 1], dataB[slot * 4 + 2], dataB[slot * 4 + 3],
      ]);
    }
  }
  return out;
}

describe("static-topology water clipmap", () => {
  const field = buildField();

  it("uses static geometry: full index buffer, grid-index positions, aLevel", () => {
    const scene = new THREE.Scene();
    const capture: StaticCapture = { grid: null, origins: [] };
    const clipmap = buildStaticClipmap(field, scene, capture);
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    const mesh = scene.getObjectByName("water-clipmap-L0") as THREE.Mesh<THREE.BufferGeometry>;
    expect(capture.grid).not.toBeNull();
    const index = mesh.geometry.getIndex()!;
    expect(index.count).toBe(CELLS_PER_LEVEL * CELLS_PER_LEVEL * 6);
    expect(mesh.geometry.drawRange.count).toBe(Infinity);
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.getX(0)).toBe(0);
    expect(pos.getX(VERTS - 1)).toBe(CELLS_PER_LEVEL);
    expect(mesh.geometry.getAttribute("aLevel")).toBeDefined();
    // Legacy per-vertex attributes are gone: the vertex stage samples texels instead.
    expect(mesh.geometry.getAttribute("aTerrainY")).toBeUndefined();
    clipmap.dispose();
  });

  it("never rebuilds indices; snaps update texels and origin uniforms only", () => {
    const scene = new THREE.Scene();
    const capture: StaticCapture = { grid: null, origins: [] };
    const clipmap = buildStaticClipmap(field, scene, capture);
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    for (let step = 1; step <= 4; step++) {
      clipmap.update(0, new THREE.Vector3(256 + step * CELL_SIZE, 30, 256));
    }
    const stats = clipmap.updateCostStats;
    expect(stats.indexRebuilds).toBe(0);
    expect(stats.staticSnaps).toBe(5);
    expect(stats.fullRefills).toBe(1);
    expect(stats.partialRefills).toBe(4);
    // 9 verts per newly exposed column, 4 partial snaps.
    expect(stats.fieldSamples).toBe(VERTS * VERTS + 4 * VERTS);
    expect(capture.origins.length).toBe(5);
    const last = capture.origins[capture.origins.length - 1]!;
    expect(last.originMinX).toBeCloseTo(256 + 4 * CELL_SIZE - (CELLS_PER_LEVEL * CELL_SIZE) / 2, 10);
    expect(last.baseSlotX).toBe(torusSlot(Math.round(last.originMinX / CELL_SIZE), VERTS));
    clipmap.dispose();
  });

  it("moved texels match a freshly built clipmap and the field exactly (gold parity)", () => {
    const sceneA = new THREE.Scene();
    const captureA: StaticCapture = { grid: null, origins: [] };
    const clipmapA = buildStaticClipmap(field, sceneA, captureA);
    clipmapA.update(0, new THREE.Vector3(256, 30, 256));
    for (let step = 1; step <= 4; step++) {
      clipmapA.update(0, new THREE.Vector3(256 + step * CELL_SIZE, 30, 256));
    }

    const sceneB = new THREE.Scene();
    const captureB: StaticCapture = { grid: null, origins: [] };
    const clipmapB = buildStaticClipmap(field, sceneB, captureB);
    clipmapB.update(0, new THREE.Vector3(256 + 4 * CELL_SIZE, 30, 256));

    const snapA = texelSnapshot(captureA);
    const snapB = texelSnapshot(captureB);
    expect(snapB.size).toBe(VERTS * VERTS);
    for (const [key, b] of snapB) {
      const a = snapA.get(key);
      expect(a, `world vertex ${key} missing from moved clipmap`).toBeDefined();
      expect(a).toEqual(b);
    }

    // Texels equal direct field samples (same channels the legacy attributes carried).
    const [wx, wz] = [256 + 4 * CELL_SIZE, 256];
    const sample = field.sampleForCellSize(wx, wz, CELL_SIZE);
    const texel = snapB.get(`${wx},${wz}`)!;
    expect(texel[0]).toBeCloseTo(sample.waterY, 5);
    expect(texel[1]).toBeCloseTo(sample.terrainY, 5);
    expect(texel[2]).toBeCloseTo(sample.bodyMask, 5);
    expect(texel[3]).toBeCloseTo(sample.bodyKind, 5);
    expect(texel[4]).toBeCloseTo(sample.flow.x, 5);
    expect(texel[5]).toBeCloseTo(sample.flow.z, 5);
    expect(texel[6]).toBeCloseTo(sample.flow.speed, 5);
    expect(texel[7]).toBeCloseTo(sample.flow.drop, 5);

    clipmapA.dispose();
    clipmapB.dispose();
  });

  it("legacy factory (no staticGrid) keeps the index-rebuild path", () => {
    const scene = new THREE.Scene();
    const capture: StaticCapture = { grid: null, origins: [] };
    const config = resolveWaterConfig(parseWaterConfig("water:\n  enabled: true\n", () => {}), WORLD_CELLS);
    config.cellSizes = [CELL_SIZE];
    config.cellsPerLevel = CELLS_PER_LEVEL;
    config.snapCells = 1;
    const legacyFactory = (params: WaterMaterialParams): WaterMaterialHandle => {
      const full = makeStaticMaterialFactory(capture)(params);
      // A material that does not support static topology returns no staticGrid handle.
      return { ...full, staticGrid: undefined };
    };
    const clipmap = new WaterClipmap({
      scene,
      config,
      field,
      createMaterial: legacyFactory,
      sunDirection: new THREE.Vector3(0, 1, 0),
      cameraPosition: new THREE.Vector3(),
      worldBounds: { cellsX: 0, cellsZ: 0 },
      staticTopology: true,
    });
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    expect(clipmap.updateCostStats.indexRebuilds).toBe(1);
    expect(clipmap.updateCostStats.staticSnaps).toBe(0);
    const mesh = scene.getObjectByName("water-clipmap-L0") as THREE.Mesh<THREE.BufferGeometry>;
    expect(mesh.geometry.getAttribute("aTerrainY")).toBeDefined();
    clipmap.dispose();
  });
});
