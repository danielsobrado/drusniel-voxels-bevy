import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { surfaceHeight } from "../terrain.js";
import { buildLod0PageSource } from "../source_mesh.js";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import {
  DEFAULT_WATER_CONFIG,
  WATER_DEBUG_MODES,
  WaterClipmap,
  WaterField,
  cloneWaterConfig,
  parseWaterConfig,
  type TerrainHeightSampler,
} from "./index.js";
import { createWaterShaderMaterial } from "./waterMaterial.js";
import waterYamlText from "../../config/water.yaml?raw";

const sampler: TerrainHeightSampler = { surfaceHeight };

function makeConfig(): ClodPagesConfig {
  return {
    page: { chunks_per_page: 1, chunk_size: 8, halo_chunks: 1, quadtree_levels: 1 },
    simplify: {
      target_ratio_per_level: 0.5,
      abandon_ratio: 0.99,
      target_error: 0.01,
      weld_epsilon_cells: 0.001,
      attribute_weights: { normal: 1, material: 0.25 },
    },
    polish: { diagonal_flip: { ...DEFAULT_DIAGONAL_FLIP_CONFIG, enabled: false } },
    selection: {
      error_threshold_px: 4,
      hysteresis_merge_factor: 1.5,
      neighbor_level_delta_max: 1,
      transition_mode: "instant",
      crossfade_frames: 0,
    },
    near_field: { radius_chunks: 1 },
    meshopt_package_version: "0.22.0",
  };
}

describe("parseWaterConfig", () => {
  it("parses the bundled config/water.yaml", () => {
    const cfg = parseWaterConfig(waterYamlText, null);
    expect(cfg.enabled).toBe(true);
    expect(cfg.cellsPerLevel).toBe(128);
    expect(cfg.cellSizes).toEqual([1.5, 3.0, 6.0, 12.0, 24.0]);
    expect(cfg.snapCells).toBe(2);
    expect(cfg.drySentinelDepth).toBe(2.0);
    expect(cfg.fakeBodies.lakes).toHaveLength(2);
    expect(cfg.fakeBodies.rivers).toHaveLength(1);
    expect(cfg.fakeBodies.rivers[0].points).toHaveLength(5);
    expect(cfg.visual.alpha).toBeCloseTo(0.82);
    expect(cfg.debug.mode).toBe(WATER_DEBUG_MODES.final);
  });

  it("falls back to defaults on empty input", () => {
    const cfg = parseWaterConfig("", null);
    expect(cfg.cellSizes).toEqual(DEFAULT_WATER_CONFIG.cellSizes);
    expect(cfg.fakeBodies.lakes).toHaveLength(DEFAULT_WATER_CONFIG.fakeBodies.lakes.length);
  });

  it("clamps invalid debug mode to default", () => {
    const cfg = parseWaterConfig("water:\n  debug:\n    mode: 99\n", null);
    expect(cfg.debug.mode).toBe(WATER_DEBUG_MODES.final);
  });
});

describe("WaterField", () => {
  const cfg = parseWaterConfig(waterYamlText, null);
  const field = new WaterField(cfg, sampler);

  it("returns terrainY - sentinel in dry areas (far from any body)", () => {
    const x = 1000;
    const z = 1000;
    const terrainY = surfaceHeight(x, z);
    expect(field.waterYAt(x, z)).toBeCloseTo(terrainY - cfg.drySentinelDepth, 5);
    expect(field.depthAt(x, z)).toBeCloseTo(-cfg.drySentinelDepth, 5);
  });

  it("returns a flat lake level inside a lake near its center", () => {
    const lake = cfg.fakeBodies.lakes[0];
    const centerLevel = surfaceHeight(lake.center[0], lake.center[1]) + lake.levelOffset;
    const waterY = field.waterYAt(lake.center[0], lake.center[1]);
    expect(waterY).toBeCloseTo(centerLevel, 4);
    // A point offset inside the ellipse stays at the same flat level.
    const innerX = lake.center[0] + lake.radius[0] * 0.2;
    const innerZ = lake.center[1] + lake.radius[1] * 0.2;
    expect(field.waterYAt(innerX, innerZ)).toBeCloseTo(centerLevel, 3);
  });

  it("reports positive body mask inside a lake and zero far away", () => {
    const lake = cfg.fakeBodies.lakes[0];
    expect(field.bodyMaskAt(lake.center[0], lake.center[1])).toBeGreaterThan(0.9);
    expect(field.bodyMaskAt(1000, 1000)).toBe(0);
  });

  it("returns a sloped river level at the polyline start", () => {
    const river = cfg.fakeBodies.rivers[0];
    const start = river.points[0];
    const startLevel = surfaceHeight(start[0], start[1]) + river.levelOffset;
    expect(field.waterYAt(start[0], start[1])).toBeCloseTo(startLevel, 4);
    expect(field.depthAt(start[0], start[1])).toBeGreaterThan(0);
  });

  it("river flow follows the first segment direction", () => {
    const river = cfg.fakeBodies.rivers[0];
    const start = river.points[0];
    const flow = field.flowAt(start[0], start[1]);
    expect(flow.speed).toBeGreaterThan(0);
    const segDx = river.points[1][0] - river.points[0][0];
    const segDz = river.points[1][1] - river.points[0][1];
    const segLen = Math.hypot(segDx, segDz);
    const expectedX = segDx / segLen;
    const expectedZ = segDz / segLen;
    expect(flow.x).toBeCloseTo(expectedX, 4);
    expect(flow.z).toBeCloseTo(expectedZ, 4);
  });

  it("lake flow is near-zero", () => {
    const lake = cfg.fakeBodies.lakes[0];
    const flow = field.flowAt(lake.center[0], lake.center[1]);
    expect(flow.speed).toBe(0);
  });
});

describe("WaterClipmap", () => {
  it("creates one mesh per cell size and follows the camera", () => {
    const cfg = cloneWaterConfig(parseWaterConfig(waterYamlText, null));
    const scene = new THREE.Scene();
    const field = new WaterField(cfg, sampler);
    const clipmap = new WaterClipmap({
      scene,
      config: cfg,
      field,
      createMaterial: (params) => createWaterShaderMaterial(params),
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
      cameraPosition: new THREE.Vector3(0, 50, 0),
    });
    expect(clipmap.levelCount).toBe(cfg.cellSizes.length);
    const root = scene.children.find((child) => child.name === "water-clipmap-root");
    expect(root).toBeDefined();
    expect(root!.children.length).toBe(cfg.cellSizes.length);
    clipmap.update(0.016, new THREE.Vector3(80, 50, -70));
    clipmap.dispose();
  });

  // Hard assertion: the fake water layer must NEVER feed the CLOD page source
  // mesh, meshoptimizer input, page borders, or page validation. Building and
  // updating the full water clipmap must not mutate page source signatures.
  it("does not mutate CLOD page source mesh signatures", () => {
    const pageCfg = makeConfig();
    const world = { cellsX: 8, cellsZ: 8 };
    const page = buildLod0PageSource(0, 0, pageCfg, world);
    const before = {
      positions: page.mesh.positions.length,
      normals: page.mesh.normals.length,
      materials: page.mesh.materials.length,
      indices: page.mesh.indices.length,
      firstPos: page.mesh.positions[0],
      lastPos: page.mesh.positions[page.mesh.positions.length - 1],
    };

    const waterCfg = cloneWaterConfig(parseWaterConfig(waterYamlText, null));
    const scene = new THREE.Scene();
    const field = new WaterField(waterCfg, sampler);
    const clipmap = new WaterClipmap({
      scene,
      config: waterCfg,
      field,
      createMaterial: (params) => createWaterShaderMaterial(params),
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
      cameraPosition: new THREE.Vector3(0, 50, 0),
    });
    // Drive several frames across the lake so the clipmap fills vertices.
    for (let i = 0; i < 5; i++) {
      clipmap.update(0.016, new THREE.Vector3(80 + i, 50, -70 + i));
    }
    clipmap.dispose();

    expect(page.mesh.positions.length).toBe(before.positions);
    expect(page.mesh.normals.length).toBe(before.normals);
    expect(page.mesh.materials.length).toBe(before.materials);
    expect(page.mesh.indices.length).toBe(before.indices);
    expect(page.mesh.positions[0]).toBe(before.firstPos);
    expect(page.mesh.positions[page.mesh.positions.length - 1]).toBe(before.lastPos);
  });
});
