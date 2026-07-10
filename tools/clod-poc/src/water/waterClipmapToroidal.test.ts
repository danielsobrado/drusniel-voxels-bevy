import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WaterClipmap } from "./waterClipmap.js";
import { WaterField } from "./waterField.js";
import { HydrologySystem } from "./hydrologySystem.js";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { createWaterShaderMaterial } from "./waterMaterial.js";
import { parseWaterConfig, resolveWaterConfig } from "./water_config_parsing.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

const WORLD_CELLS = 512;

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

function buildClipmap(field: WaterField, scene: THREE.Scene): WaterClipmap {
  const config = resolveWaterConfig(parseWaterConfig("water:\n  enabled: true\n", () => {}), WORLD_CELLS);
  config.cellSizes = [2];
  config.cellsPerLevel = 8;
  config.snapCells = 1;
  return new WaterClipmap({
    scene,
    config,
    field,
    createMaterial: createWaterShaderMaterial,
    sunDirection: new THREE.Vector3(0, 1, 0),
    cameraPosition: new THREE.Vector3(),
    worldBounds: { cellsX: 0, cellsZ: 0 },
  });
}

function geometrySnapshot(scene: THREE.Scene): Map<string, { waterY: number; mask: number; terrainY: number }> {
  const mesh = scene.getObjectByName("water-clipmap-L0") as THREE.Mesh<THREE.BufferGeometry>;
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const mask = mesh.geometry.getAttribute("aBodyMask") as THREE.BufferAttribute;
  const terrain = mesh.geometry.getAttribute("aTerrainY") as THREE.BufferAttribute;
  const out = new Map<string, { waterY: number; mask: number; terrainY: number }>();
  for (let i = 0; i < pos.count; i++) {
    out.set(`${pos.getX(i)},${pos.getZ(i)}`, {
      waterY: pos.getY(i),
      mask: mask.getX(i),
      terrainY: terrain.getX(i),
    });
  }
  return out;
}

describe("toroidal water clipmap", () => {
  const field = buildField();

  it("moved clipmap matches a freshly built clipmap at the same position, with partial sampling", () => {
    const sceneA = new THREE.Scene();
    const clipmapA = buildClipmap(field, sceneA);
    clipmapA.update(0, new THREE.Vector3(256, 30, 256));
    const afterInit = clipmapA.updateCostStats;
    expect(afterInit.fullRefills).toBe(1);

    // Walk east one snap (2 m) at a time — each step exposes exactly one new column.
    for (let step = 1; step <= 4; step++) {
      clipmapA.update(0, new THREE.Vector3(256 + step * 2, 30, 256));
    }
    const afterMove = clipmapA.updateCostStats;
    expect(afterMove.partialRefills).toBe(4);
    expect(afterMove.fullRefills).toBe(1); // no further full refills
    // 9 verts per new column, 4 snaps => 36 samples, not 4 * 81.
    expect(afterMove.fieldSamples - afterInit.fieldSamples).toBe(4 * 9);
    expect(afterMove.columnsSampled - afterInit.columnsSampled).toBe(4);
    expect(afterMove.rowsSampled - afterInit.rowsSampled).toBe(0);

    // Gold reference: a fresh clipmap built directly at the final camera position.
    const sceneB = new THREE.Scene();
    const clipmapB = buildClipmap(field, sceneB);
    clipmapB.update(0, new THREE.Vector3(256 + 4 * 2, 30, 256));

    const snapA = geometrySnapshot(sceneA);
    const snapB = geometrySnapshot(sceneB);
    expect(snapB.size).toBe(81);
    for (const [key, b] of snapB) {
      const a = snapA.get(key);
      expect(a, `world vertex ${key} missing from moved clipmap`).toBeDefined();
      expect(a!.waterY).toBe(b.waterY);
      expect(a!.mask).toBe(b.mask);
      expect(a!.terrainY).toBe(b.terrainY);
    }

    clipmapA.dispose();
    clipmapB.dispose();
  });

  it("diagonal movement samples new rows and columns only", () => {
    const scene = new THREE.Scene();
    const clipmap = buildClipmap(field, scene);
    clipmap.update(0, new THREE.Vector3(300, 30, 300));
    const before = clipmap.updateCostStats;
    clipmap.update(0, new THREE.Vector3(302, 30, 302));
    const after = clipmap.updateCostStats;
    expect(after.columnsSampled - before.columnsSampled).toBe(1);
    expect(after.rowsSampled - before.rowsSampled).toBe(1);
    // One column (9) + one row (9) minus the shared corner vertex.
    expect(after.fieldSamples - before.fieldSamples).toBe(17);
    clipmap.dispose();
  });

  it("exposes the aBodyKind attribute for per-body material behaviour", () => {
    const scene = new THREE.Scene();
    const clipmap = buildClipmap(field, scene);
    clipmap.update(0, new THREE.Vector3(256, 30, 256));
    const mesh = scene.getObjectByName("water-clipmap-L0") as THREE.Mesh<THREE.BufferGeometry>;
    const kind = mesh.geometry.getAttribute("aBodyKind") as THREE.BufferAttribute;
    expect(kind).toBeDefined();
    expect(kind.count).toBe(81);
    clipmap.dispose();
  });

  it("no snap means no sampling and no index rebuild", () => {
    const scene = new THREE.Scene();
    const clipmap = buildClipmap(field, scene);
    clipmap.update(0, new THREE.Vector3(400, 30, 400));
    const before = clipmap.updateCostStats;
    clipmap.update(0, new THREE.Vector3(400.4, 30, 400.4)); // below snap distance
    const after = clipmap.updateCostStats;
    expect(after.fieldSamples).toBe(before.fieldSamples);
    expect(after.indexRebuilds).toBe(before.indexRebuilds);
    clipmap.dispose();
  });
});
