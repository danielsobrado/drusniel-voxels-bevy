import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  WaterClipmap,
  WaterField,
  cloneWaterConfig,
  collectWaterClipmapRuntimeStats,
} from "./index.js";
import { createWaterShaderMaterial } from "./waterMaterial.js";

function createTestClipmap(enabled = true): {
  scene: THREE.Scene;
  clipmap: WaterClipmap;
  config: ReturnType<typeof cloneWaterConfig>;
} {
  const config = cloneWaterConfig();
  config.enabled = enabled;
  config.source = "fake_bodies";
  config.cellsPerLevel = 16;
  config.cellSizes = [2, 4];
  config.snapCells = 1;
  config.fakeBodies.lakes = [{ center: [64, 64], radius: [48, 48], levelOffset: 2 }];
  config.fakeBodies.rivers = [];

  const scene = new THREE.Scene();
  const field = new WaterField(config, { surfaceHeight: () => 10 });
  const clipmap = new WaterClipmap({
    scene,
    config,
    field,
    createMaterial: (params) => createWaterShaderMaterial(params),
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
    cameraPosition: new THREE.Vector3(64, 40, 64),
    worldBounds: { cellsX: 128, cellsZ: 128 },
  });

  return { scene, clipmap, config };
}

describe("WaterClipmap runtime stats", () => {
  it("reports zero visible levels and triangles while disabled", () => {
    const { scene, clipmap, config } = createTestClipmap(false);
    clipmap.update(0.016, new THREE.Vector3(64, 40, 64));

    const stats = collectWaterClipmapRuntimeStats(clipmap, scene, config.cellSizes);

    expect(stats.enabled).toBe(false);
    expect(stats.levelCount).toBe(2);
    expect(stats.visibleLevelCount).toBe(0);
    expect(stats.indexCount).toBe(0);
    expect(stats.triangleCount).toBe(0);

    clipmap.dispose();
  });

  it("reports visible draw counts after the clipmap fills around water", () => {
    const { scene, clipmap, config } = createTestClipmap(true);
    clipmap.update(0.016, new THREE.Vector3(64, 40, 64));

    const stats = collectWaterClipmapRuntimeStats(clipmap, scene, config.cellSizes);

    expect(stats.enabled).toBe(true);
    expect(stats.levelCount).toBe(2);
    expect(stats.visibleLevelCount).toBeGreaterThan(0);
    expect(stats.indexCount).toBeGreaterThan(0);
    expect(stats.triangleCount).toBeGreaterThan(0);
    expect(stats.levels[0].cellSize).toBe(2);
    expect(stats.levels[0].rect).not.toBeNull();

    clipmap.dispose();
  });

  it("spreads simultaneous level refills across frames", () => {
    const { clipmap } = createTestClipmap(true);
    const start = new THREE.Vector3(64, 40, 64);
    clipmap.update(0.016, start);
    clipmap.update(0.016, start);
    const before = clipmap.updateCostStats.snaps;

    clipmap.update(0.016, new THREE.Vector3(72, 40, 72));

    expect(clipmap.updateCostStats.snaps - before).toBe(1);
    clipmap.dispose();
  });
});
