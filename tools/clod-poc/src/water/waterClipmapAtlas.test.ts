import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WaterClipmap, type WaterClipmapAtlasRuntime } from "./waterClipmap.js";
import { WaterField } from "./waterField.js";
import { HydrologySystem } from "./hydrologySystem.js";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { parseWaterConfig, resolveWaterConfig } from "./water_config_parsing.js";
import type { TerrainHeightSampler } from "./water_field_types.js";
import type { WaterAtlasGridParams, WaterMaterialHandle, WaterMaterialParams } from "./water_material_types.js";

const WORLD_CELLS = 512;
const CELLS_PER_LEVEL = 8;
const CELL_SIZE = 2;

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

interface AtlasCapture {
  params: WaterAtlasGridParams[];
  staticOffered: number;
  origins: Array<{ x: number; z: number }>;
  windows: Array<{ x: number; z: number; enabled: boolean }>;
}

function makeAtlasRuntime(coveredHalfSpanM: number): WaterClipmapAtlasRuntime & { origin: { x: number; z: number } | null } {
  const data = new Float32Array(4 * 4 * 4);
  const texture = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat, THREE.FloatType);
  return {
    coveredHalfSpanM,
    origin: null,
    materialParamsForLevel(levelCellSize: number): WaterAtlasGridParams {
      return { atlasA: texture, atlasB: texture, res: 4, atlasCellSize: 4, levelCellSize };
    },
    windowOrigin() {
      return this.origin;
    },
  };
}

function makeAtlasMaterialFactory(capture: AtlasCapture) {
  return (params: WaterMaterialParams): WaterMaterialHandle => {
    if (params.atlasGrid) capture.params.push(params.atlasGrid);
    if (params.staticGrid) capture.staticOffered++;
    return {
      material: new THREE.MeshBasicMaterial(),
      ...(params.atlasGrid
        ? {
            atlasGrid: {
              setOrigin: (x: number, z: number) => capture.origins.push({ x, z }),
              setWindow: (x: number, z: number, enabled: boolean) => capture.windows.push({ x, z, enabled }),
            },
          }
        : {}),
      ...(params.staticGrid
        ? { staticGrid: { setOrigin: () => {} } }
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

function buildClipmap(
  field: WaterField,
  scene: THREE.Scene,
  capture: AtlasCapture,
  runtime: WaterClipmapAtlasRuntime,
  cellSizes: number[] = [CELL_SIZE],
): WaterClipmap {
  const config = resolveWaterConfig(parseWaterConfig("water:\n  enabled: true\n", () => {}), WORLD_CELLS);
  config.cellSizes = cellSizes;
  config.cellsPerLevel = CELLS_PER_LEVEL;
  config.snapCells = 1;
  return new WaterClipmap({
    scene,
    config,
    field,
    createMaterial: makeAtlasMaterialFactory(capture),
    sunDirection: new THREE.Vector3(0, 1, 0),
    cameraPosition: new THREE.Vector3(),
    worldBounds: { cellsX: 0, cellsZ: 0 },
    staticTopology: true,
    atlasRuntime: runtime,
  });
}

describe("atlas-driven water clipmap levels", () => {
  const field = buildField();

  it("takes zero CPU field samples on snaps and pushes origin + window uniforms", () => {
    const scene = new THREE.Scene();
    const capture: AtlasCapture = { params: [], staticOffered: 0, origins: [], windows: [] };
    const runtime = makeAtlasRuntime(1000);
    const clipmap = buildClipmap(field, scene, capture, runtime);
    runtime.origin = { x: 128, z: 96 };
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    for (let step = 1; step <= 4; step++) {
      clipmap.update(0, new THREE.Vector3(256 + step * CELL_SIZE, 30, 256));
    }
    const stats = clipmap.updateCostStats;
    expect(capture.params.length).toBe(1);
    expect(stats.fieldSamples).toBe(0);
    expect(stats.indexRebuilds).toBe(0);
    expect(stats.staticSnaps).toBe(5);
    expect(capture.origins.length).toBe(5);
    const last = capture.origins[capture.origins.length - 1]!;
    expect(last.x).toBeCloseTo(256 + 4 * CELL_SIZE - (CELLS_PER_LEVEL * CELL_SIZE) / 2, 10);
    // Window pushed every frame with the runtime origin.
    expect(capture.windows.length).toBe(5);
    expect(capture.windows[capture.windows.length - 1]).toEqual({ x: 128, z: 96, enabled: true });
    // Mesh stays visible; dry areas resolve in the vertex/fragment stages.
    const mesh = scene.getObjectByName("water-clipmap-L0") as THREE.Mesh;
    expect(mesh.visible).toBe(true);
    clipmap.dispose();
  });

  it("disables the window uniform until the atlas initializes", () => {
    const scene = new THREE.Scene();
    const capture: AtlasCapture = { params: [], staticOffered: 0, origins: [], windows: [] };
    const runtime = makeAtlasRuntime(1000);
    const clipmap = buildClipmap(field, scene, capture, runtime);
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    expect(capture.windows[0]).toEqual({ x: 0, z: 0, enabled: false });
    clipmap.dispose();
  });

  it("falls back to the static texel path for levels the window cannot cover", () => {
    const scene = new THREE.Scene();
    const capture: AtlasCapture = { params: [], staticOffered: 0, origins: [], windows: [] };
    // Coverage below L0's half-span (8 m): no level qualifies for the atlas.
    const runtime = makeAtlasRuntime(4);
    const clipmap = buildClipmap(field, scene, capture, runtime);
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    expect(capture.params.length).toBe(0);
    expect(capture.staticOffered).toBe(1);
    expect(clipmap.updateCostStats.fieldSamples).toBeGreaterThan(0);
    clipmap.dispose();
  });
});
