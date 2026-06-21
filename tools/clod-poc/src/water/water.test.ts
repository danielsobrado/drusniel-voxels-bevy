import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { surfaceHeight } from "../terrain.js";
import { buildLod0PageSource } from "../source_mesh.js";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import {
  DEFAULT_WATER_CONFIG,
  HydrologySystem,
  WATER_DEBUG_MODES,
  WaterClipmap,
  WaterField,
  buildWaterSurface,
  cloneWaterConfig,
  computeFlowAccumulation,
  createHydrologyGrid,
  fillDepressions,
  parseWaterConfig,
  resolveWaterConfig,
  carveRiversAndClassifyWater,
  type TerrainHeightSampler,
  waterQuadRenderable,
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
    const parsed = parseWaterConfig(waterYamlText, null);
    expect(parsed.enabled).toBe(true);
    expect(parsed.cellsPerLevel).toBe(128);
    expect(parsed.cellSizes).toEqual([1.5, 3.0, 6.0, 12.0, 24.0]);
    expect(parsed.snapCells).toBe(2);
    expect(parsed.drySentinelDepth).toBe(2.0);
    expect(parsed.fakeBodies.lakes).toHaveLength(2);
    expect(parsed.fakeBodies.rivers).toHaveLength(1);
    expect(parsed.fakeBodies.rivers[0].pointsNorm).toBeDefined();
    expect(parsed.fakeBodies.rivers[0].pointsNorm!.length).toBe(5);

    const cfg = resolveWaterConfig(parsed, 128);
    expect(cfg.fakeBodies.rivers[0].points).toHaveLength(5);
    expect(cfg.visual.alpha).toBeCloseTo(0.82);
    expect(cfg.visual.foam.noiseScale).toBeGreaterThan(0);
    expect(cfg.visual.fresnel.normalFlatten).toBeGreaterThan(0);
    expect(cfg.visual.color.depthScale).toBeGreaterThan(0);
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

  it("skips rivers with fewer than two valid absolute points", () => {
    const warnings: string[] = [];
    const yaml = `water:\n  fake_bodies:\n    lakes: []\n    rivers:\n      - points: [[1, 2]]\n        width: 5\n`;
    const cfg = parseWaterConfig(yaml, (message) => warnings.push(message));
    expect(cfg.fakeBodies.rivers).toHaveLength(0);
    expect(warnings.some((message) => message.includes("[water-config] skipping river entry 0"))).toBe(true);
  });

  it("skips rivers with fewer than two valid normalized points", () => {
    const warnings: string[] = [];
    const yaml = `water:\n  fake_bodies:\n    lakes: []\n    rivers:\n      - points_norm: [[0.25, 0.5]]\n        width: 5\n`;
    const cfg = parseWaterConfig(yaml, (message) => warnings.push(message));
    expect(cfg.fakeBodies.rivers).toHaveLength(0);
    expect(warnings.some((message) => message.includes("[water-config] skipping river entry 0"))).toBe(true);
  });
});

describe("WaterField", () => {
  const cfg = resolveWaterConfig(parseWaterConfig(waterYamlText, null), 1000);
  cfg.source = "fake_bodies";
  const field = new WaterField(cfg, sampler);

  it("returns terrainY - sentinel in dry areas (far from any body)", () => {
    const x = 1000;
    const z = 1000;
    const terrainY = surfaceHeight(x, z);
    expect(field.waterYAt(x, z)).toBeCloseTo(terrainY - cfg.drySentinelDepth, 5);
    expect(field.depthAt(x, z)).toBeCloseTo(-cfg.drySentinelDepth, 5);
  });

  it("bases fake lake level on sampled basin terrain, not the center only", () => {
    const local = cloneWaterConfig();
    local.source = "fake_bodies";
    local.fakeBodies.lakes = [{ center: [0, 0], radius: [20, 20], levelOffset: 1 }];
    local.fakeBodies.rivers = [];
    const lakeField = new WaterField(local, {
      surfaceHeight: (x, z) => (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6 ? 100 : 10),
    });
    const waterY = lakeField.waterYAt(0, 0);
    expect(waterY).toBeCloseTo(11, 4);
    expect(waterY).not.toBeCloseTo(101, 4);
    expect(lakeField.waterYAt(6, 0)).toBeCloseTo(waterY, 4);
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

  it("keeps lake mask high inside and fades outside the ellipse", () => {
    const local = cloneWaterConfig();
    local.fakeBodies.lakes = [{ center: [50, 50], radius: [20, 10], levelOffset: 5 }];
    local.fakeBodies.rivers = [];
    const lakeField = new WaterField(local, { surfaceHeight: () => 10 });
    expect(lakeField.bodyMaskAt(50, 50)).toBeGreaterThan(0.95);
    expect(lakeField.bodyMaskAt(70, 50)).toBe(0);
    expect(lakeField.bodyMaskAt(50, 61)).toBe(0);
  });

  it("uses a river capsule mask around the configured polyline", () => {
    const local = cloneWaterConfig();
    local.fakeBodies.lakes = [];
    local.fakeBodies.rivers = [{ points: [[0, 0], [100, 0]], width: 20, levelOffset: 4, downstreamDrop: 2 }];
    const riverField = new WaterField(local, { surfaceHeight: () => 10 });
    expect(riverField.bodyMaskAt(50, 0)).toBeGreaterThan(0.95);
    expect(riverField.bodyMaskAt(50, 9)).toBeGreaterThan(0);
    expect(riverField.bodyMaskAt(50, 11)).toBe(0);
  });

  it("ignores runtime rivers with fewer than two absolute points", () => {
    const local = cloneWaterConfig();
    local.fakeBodies.lakes = [];
    local.fakeBodies.rivers = [{ points: [], width: 20, levelOffset: 4, downstreamDrop: 2 }];
    const riverField = new WaterField(local, { surfaceHeight: () => 10 });
    const s = riverField.sample(0, 0);
    expect(s.bodyMask).toBe(0);
    expect(s.depth).toBeLessThan(0);
  });

  it("keeps the dry sentinel below terrain outside any body", () => {
    const local = cloneWaterConfig();
    local.drySentinelDepth = 3.5;
    local.fakeBodies.lakes = [];
    local.fakeBodies.rivers = [];
    const dryField = new WaterField(local, { surfaceHeight: () => 42 });
    const s = dryField.sample(10, 10);
    expect(s.waterY).toBeCloseTo(38.5);
    expect(s.depth).toBeCloseTo(-3.5);
    expect(s.waterY).toBeLessThan(s.terrainY);
  });

  it("follows the closest river segment and fades flow speed near banks", () => {
    const local = cloneWaterConfig();
    local.fakeBodies.lakes = [];
    local.fakeBodies.rivers = [{ points: [[0, 0], [100, 0], [100, 100]], width: 20, levelOffset: 4, downstreamDrop: 4 }];
    const riverField = new WaterField(local, { surfaceHeight: () => 10 });
    const center = riverField.flowAt(50, 0);
    const bank = riverField.flowAt(50, 8);
    const turn = riverField.flowAt(100, 50);
    expect(center.x).toBeCloseTo(1, 4);
    expect(center.z).toBeCloseTo(0, 4);
    expect(bank.speed).toBeLessThan(center.speed);
    expect(turn.x).toBeCloseTo(0, 4);
    expect(turn.z).toBeCloseTo(1, 4);
    expect(center.drop).toBeCloseTo(4);
  });

  it("does not return NaN or Infinity for a grid of samples", () => {
    for (let z = 0; z <= 1000; z += 50) {
      for (let x = 0; x <= 1000; x += 50) {
        const s = field.sample(x, z);
        expect(Number.isFinite(s.waterY)).toBe(true);
        expect(Number.isFinite(s.terrainY)).toBe(true);
        expect(Number.isFinite(s.depth)).toBe(true);
        expect(Number.isFinite(s.bodyMask)).toBe(true);
        expect(Number.isFinite(s.flow.x)).toBe(true);
        expect(Number.isFinite(s.flow.z)).toBe(true);
        expect(Number.isFinite(s.flow.speed)).toBe(true);
        expect(Number.isFinite(s.flow.progress)).toBe(true);
        expect(Number.isFinite(s.flow.drop)).toBe(true);
      }
    }
  });
});

describe("WaterClipmap", () => {
  it("creates one mesh per cell size and follows the camera", () => {
    const cfg = resolveWaterConfig(parseWaterConfig(waterYamlText, null), 1000);
    const scene = new THREE.Scene();
    const field = new WaterField(cfg, sampler);
    const clipmap = new WaterClipmap({
      scene,
      config: cfg,
      field,
      createMaterial: (params) => createWaterShaderMaterial(params),
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
      cameraPosition: new THREE.Vector3(0, 50, 0),
      worldBounds: { cellsX: 1000, cellsZ: 1000 },
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

    const waterCfg = resolveWaterConfig(parseWaterConfig(waterYamlText, null), 8);
    const scene = new THREE.Scene();
    const field = new WaterField(waterCfg, sampler);
    const clipmap = new WaterClipmap({
      scene,
      config: waterCfg,
      field,
      createMaterial: (params) => createWaterShaderMaterial(params),
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
      cameraPosition: new THREE.Vector3(0, 50, 0),
      worldBounds: { cellsX: 8, cellsZ: 8 },
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

  // Regression: the clipmap grid must be centered around the camera so water
  // covers all four quadrants, not just +X/+Z from the snapped origin.
  it("centers the grid around the camera in all four quadrants", () => {
    const waterCfg = resolveWaterConfig(parseWaterConfig(waterYamlText, null), 1000);
    // Use a single coarse level for easy reasoning.
    waterCfg.cellSizes = [4.0];
    waterCfg.cellsPerLevel = 8;
    const scene = new THREE.Scene();
    const field = new WaterField(waterCfg, sampler);
    const clipmap = new WaterClipmap({
      scene,
      config: waterCfg,
      field,
      createMaterial: (params) => createWaterShaderMaterial(params),
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
      cameraPosition: new THREE.Vector3(0, 50, 0),
      worldBounds: { cellsX: 1000, cellsZ: 1000 },
    });
    clipmap.update(0.016, new THREE.Vector3(0, 50, 0));

    const root = scene.children.find((c) => c.name === "water-clipmap-root")!;
    const mesh = root.children[0] as THREE.Mesh;
    const pos = (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);
      maxX = Math.max(maxX, pos[i]);
      minZ = Math.min(minZ, pos[i + 2]);
      maxZ = Math.max(maxZ, pos[i + 2]);
    }
    // Camera at (0,_,0): grid should extend into negative AND positive territory.
    expect(minX).toBeLessThan(0);
    expect(maxX).toBeGreaterThan(0);
    expect(minZ).toBeLessThan(0);
    expect(maxZ).toBeGreaterThan(0);
    clipmap.dispose();
  });
});

describe("WaterField terrain-above-water", () => {
  // Regression: when terrain is higher than the lake water level inside the
  // lake mask, depth must be negative so the shader discards. The old
  // Math.max(lake.waterLevel, terrainY + 0.05) clamped water above the terrain.
  it("produces negative depth when terrain is above lake level", () => {
    const cfg = cloneWaterConfig();
    cfg.source = "fake_bodies";
    cfg.fakeBodies.lakes = [{ center: [0, 0], radius: [100, 100], levelOffset: 1.0 }];
    cfg.fakeBodies.rivers = [];
    // A single high spike inside a mostly low basin should not lift the flat lake level.
    const varySampler: TerrainHeightSampler = {
      surfaceHeight: (x: number, z: number) => (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6 ? 300 : 50),
    };
    const field = new WaterField(cfg, varySampler);
    const result = field.sample(0, 0);
    expect(result.waterY).toBe(51);
    expect(result.depth).toBeLessThan(0);
    expect(result.bodyMask).toBeGreaterThan(0);
  });
});

describe("parseWaterConfig empty arrays", () => {
  it("explicit empty lakes array produces no lakes", () => {
    const yaml = `water:\n  fake_bodies:\n    lakes: []\n    rivers:\n      - points: [[-10, -10], [10, 10]]\n        width: 5\n`;
    const cfg = parseWaterConfig(yaml, null);
    expect(cfg.fakeBodies.lakes).toHaveLength(0);
    expect(cfg.fakeBodies.rivers).toHaveLength(1);
  });

  it("explicit empty rivers array produces no rivers", () => {
    const yaml = `water:\n  fake_bodies:\n    lakes:\n      - center: [0, 0]\n        radius: [50, 50]\n        level_offset: 1\n    rivers: []\n`;
    const cfg = parseWaterConfig(yaml, null);
    expect(cfg.fakeBodies.lakes).toHaveLength(1);
    expect(cfg.fakeBodies.rivers).toHaveLength(0);
  });
});

describe("Water world-bounds and body-mask clipping constraints", () => {
  it("satisfies the clipping, dry, and wet point assertions", () => {
    const cfg = cloneWaterConfig();
    cfg.source = "fake_bodies";
    cfg.fakeBodies.lakes = [{ center: [100, 100], radius: [30, 30], levelOffset: 2 }];
    cfg.fakeBodies.rivers = [];
    const field = new WaterField(cfg, { surfaceHeight: () => 10 });

    // 1. A dry point outside any body -> bodyMask = 0 and depth <= 0
    const dryResult = field.sample(1000, 1000);
    expect(dryResult.bodyMask).toBe(0);
    expect(dryResult.depth).toBeLessThanOrEqual(0);

    // 2. A wet point inside a configured lake -> bodyMask > 0 and depth > 0
    const wetResult = field.sample(100, 100);
    expect(wetResult.bodyMask).toBeGreaterThan(0);
    expect(wetResult.depth).toBeGreaterThan(0);

    // 3. A point outside world bounds -> not renderable (CPU refill sets attributes to 0/sentinel)
    const scene = new THREE.Scene();
    const clipmap = new WaterClipmap({
      scene,
      config: cfg,
      field,
      createMaterial: (params) => createWaterShaderMaterial(params),
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
      cameraPosition: new THREE.Vector3(0, 50, 0),
      worldBounds: { cellsX: 1000, cellsZ: 1000 },
    });
    clipmap.update(0.016, new THREE.Vector3(0, 50, 0));
    const root = scene.children.find((c) => c.name === "water-clipmap-root")!;
    const mesh = root.children[0] as THREE.Mesh;
    const pos = (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array;
    const bodyMaskAttr = (mesh.geometry.getAttribute("aBodyMask") as THREE.BufferAttribute).array;
    const terrainYAttr = (mesh.geometry.getAttribute("aTerrainY") as THREE.BufferAttribute).array;

    let countOutside = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const wx = pos[i];
      const wz = pos[i + 2];
      const vi = i / 3;
      if (wx < 0 || wx > 1000 || wz < 0 || wz > 1000) {
        countOutside++;
        expect(bodyMaskAttr[vi]).toBe(0);
        expect(terrainYAttr[vi]).toBe(0);
      }
    }
    expect(countOutside).toBeGreaterThan(0);
    clipmap.dispose();
  });
});

describe("CPU hydrology modules", () => {
  it("depression fill raises an enclosed basin and leaves borders drainable", () => {
    const grid = createHydrologyGrid(5, 4, { surfaceHeight: () => 10 });
    grid.originalBed.fill(10);
    grid.originalBed[2 * 5 + 2] = 0;
    fillDepressions(grid, {
      enabled: true,
      iterations: 20,
      epsilonPerCell: 0.01,
      lakeDelta: 2,
      marshDelta: 0.1,
    });
    expect(grid.filledSurface[2 * 5 + 2]).toBeGreaterThan(0);
    expect(grid.filledSurface[0]).toBe(10);
  });

  it("lake detection creates flat filled-surface water over a basin", () => {
    const grid = createHydrologyGrid(9, 8, { surfaceHeight: () => 10 });
    grid.originalBed.fill(10);
    grid.carvedBed.set(grid.originalBed);
    grid.filledSurface.fill(10);
    for (let z = 2; z <= 6; z++) {
      for (let x = 2; x <= 6; x++) grid.originalBed[z * 9 + x] = 6;
    }
    carveRiversAndClassifyWater(grid, cloneWaterConfig().hydrology.fill, cloneWaterConfig().hydrology.rivers, { enabled: false, iterations: 0, strength: 0 });
    expect(grid.lakeMask[4 * 9 + 4]).toBe(1);
    expect(grid.waterYRaw[4 * 9 + 4]).toBe(10);
  });

  it("shallow pits below lake_delta do not become open water", () => {
    const cfg = cloneWaterConfig().hydrology;
    const grid = createHydrologyGrid(5, 4, { surfaceHeight: () => 10 });
    grid.originalBed.fill(10);
    grid.carvedBed.set(grid.originalBed);
    grid.filledSurface.fill(10);
    grid.originalBed[2 * 5 + 2] = 9.5;
    carveRiversAndClassifyWater(grid, cfg.fill, cfg.rivers, { enabled: false, iterations: 0, strength: 0 });
    expect(grid.lakeMask[2 * 5 + 2]).toBe(0);
    expect(grid.waterYRaw[2 * 5 + 2]).toBeLessThan(-1000);
  });

  it("accumulation on a sloped plane forms downhill flow", () => {
    const grid = createHydrologyGrid(16, 15, { surfaceHeight: (x) => 30 - x });
    grid.filledSurface.set(grid.originalBed);
    computeFlowAccumulation(grid, {
      particles: 1200,
      maxSteps: 24,
      flatGradientStop: 0.0001,
      inertia: 0.2,
      jitterSeed: 7,
    }, cloneWaterConfig().hydrology.fill, {
      ...cloneWaterConfig().hydrology.rivers,
      riverThresholdAdd: 0,
      visibleWaterThresholdAdd: 2,
      widenRadius: 1,
    });
    const mid = 8 * 16 + 8;
    expect(grid.accumulation[mid]).toBeGreaterThan(0);
    expect(grid.flowDirX[mid]).toBeGreaterThan(0);
  });

  it("river carve lowers carvedBed where flowStrength is high", () => {
    const cfg = cloneWaterConfig().hydrology;
    const grid = createHydrologyGrid(5, 4, { surfaceHeight: () => 20 });
    grid.filledSurface.set(grid.originalBed);
    grid.flowStrength[2 * 5 + 2] = 1;
    grid.waterStrength[2 * 5 + 2] = 1;
    carveRiversAndClassifyWater(grid, cfg.fill, cfg.rivers, { enabled: false, iterations: 0, strength: 0 });
    expect(grid.carvedBed[2 * 5 + 2]).toBeLessThan(20);
  });

  it("waterY dry cells use 3x3 min bed minus sentinel depth", () => {
    const grid = createHydrologyGrid(3, 2, { surfaceHeight: () => 10 });
    grid.carvedBed.fill(10);
    grid.carvedBed[0] = 4;
    grid.waterYRaw.fill(-1e4);
    buildWaterSurface(grid, { wetSmoothIterations: 0, wetToWetCliffSlopeMax: 1, farReduceFactor: 8 }, 2);
    expect(grid.waterY[4]).toBe(2);
  });

  it("wet-only smoothing does not move dry cells", () => {
    const grid = createHydrologyGrid(3, 2, { surfaceHeight: () => 10 });
    grid.carvedBed.fill(10);
    grid.waterYRaw.fill(-1e4);
    grid.waterYRaw[4] = 12;
    buildWaterSurface(grid, { wetSmoothIterations: 2, wetToWetCliffSlopeMax: 10, farReduceFactor: 8 }, 2);
    expect(grid.waterY[0]).toBe(8);
    expect(grid.wetMask[0]).toBe(0);
  });

  it("wet-to-wet cliff cut removes steep water ramps", () => {
    const grid = createHydrologyGrid(3, 2, { surfaceHeight: () => 10 });
    grid.carvedBed.fill(10);
    grid.waterYRaw.fill(-1e4);
    grid.waterYRaw[4] = 10;
    grid.waterYRaw[5] = 20;
    buildWaterSurface(grid, { wetSmoothIterations: 0, wetToWetCliffSlopeMax: 0.1, farReduceFactor: 8 }, 2);
    expect(grid.wetMask[4] + grid.wetMask[5]).toBeLessThan(2);
  });

  it("WaterField bilinear hydrology sampling returns finite values", () => {
    const cfg = cloneWaterConfig();
    cfg.source = "hydrology";
    cfg.hydrology.simRes = 16;
    cfg.hydrology.fill.iterations = 10;
    cfg.hydrology.accumulation.particles = 200;
    cfg.hydrology.accumulation.maxSteps = 20;
    const hydrology = HydrologySystem.build(cfg.hydrology, 32, { surfaceHeight: (x, z) => 20 + z * 0.1 - x * 0.05 });
    const field = new WaterField(cfg, { surfaceHeight: () => 20 }, hydrology);
    const s = field.sample(12.3, 18.7);
    expect(Number.isFinite(s.waterY)).toBe(true);
    expect(Number.isFinite(s.terrainY)).toBe(true);
    expect(Number.isFinite(s.depth)).toBe(true);
  });
});

describe("water clipmap quad guards", () => {
  it("skips a quad with one dry corner", () => {
    const positions = new Float32Array([0, 11, 0, 1, 11, 0, 0, 11, 1, 1, 11, 1]);
    const terrainY = new Float32Array([10, 10, 10, 10]);
    const bodyMask = new Float32Array([1, 1, 0, 1]);
    const flow = new Float32Array(16);
    expect(waterQuadRenderable([0, 1, 2, 3], positions, terrainY, bodyMask, flow, { cellsX: 4, cellsZ: 4 })).toBe(false);
  });

  it("skips a quad with a large waterY discontinuity", () => {
    const positions = new Float32Array([0, 11, 0, 1, 20, 0, 0, 11, 1, 1, 11, 1]);
    const terrainY = new Float32Array([10, 10, 10, 10]);
    const bodyMask = new Float32Array([1, 1, 1, 1]);
    const flow = new Float32Array(16);
    expect(waterQuadRenderable([0, 1, 2, 3], positions, terrainY, bodyMask, flow, { cellsX: 4, cellsZ: 4 })).toBe(false);
  });
});
