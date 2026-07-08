import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolveFarClipmapConfig } from "./far_clipmap_config.js";
import { createFarClipmapController } from "./far_clipmap_controller.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

function config(overrides: Parameters<typeof resolveFarClipmapConfig>[0] = {}) {
  return resolveFarClipmapConfig({
    enabled: true,
    innerRadiusM: 64,
    outerRadiusM: 512,
    ringCount: 2,
    baseCellSizeM: 8,
    gridResolution: 17,
    snapSizeM: 64,
    maxRebuildsPerFrame: 0,
    ...overrides,
  });
}

function unavailableSource(): FarClipmapSource {
  return {
    isReady: () => false,
    sampleHeight: () => { throw new Error("source must not be sampled while not ready"); },
    sampleMaterial: () => 0,
    sampleBiome: () => 0,
    sampleWater: () => 0,
  };
}

function readyFlatSource(): FarClipmapSource {
  return {
    isReady: () => true,
    sampleHeight: () => 12,
    sampleMaterial: () => 1,
    sampleBiome: () => 1,
    sampleWater: () => 0,
  };
}

describe("FarClipmapController shader displacement", () => {
  it("updates reusable WebGPU grids from the source texture without CPU terrain geometry rebuilds", () => {
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(scene, config(), readyFlatSource(), {
      webGpuCompatibleMaterial: true,
    });

    const stats = controller.update(new THREE.Vector3(257.5, 0, -130.25));

    expect(stats.readyTiles).toBe(2);
    expect(stats.pendingTiles).toBe(0);
    expect(stats.snapUpdatesThisFrame).toBe(2);
    expect(stats.rebuiltTilesThisFrame).toBe(0);
    expect(stats.verticesBuiltThisFrame).toBe(0);
    expect(stats.trianglesBuiltThisFrame).toBe(0);
    expect(stats.buildMsThisFrame).toBe(0);
    expect(stats.fallbackSamplesThisFrame).toBeGreaterThan(0);
    expect(stats.shaderDisplacementEnabled).toBe(1);
    expect(stats.shaderDisplacedTiles).toBe(2);
    expect(stats.cpuBakedTiles).toBe(0);
    expect(stats.reusableGridTiles).toBe(2);
    expect(stats.snappedOriginX).toBe(256);
    expect(stats.snappedOriginZ).toBe(-192);
    expect(stats.snapErrorMaxM).toBeLessThan(64);

    controller.dispose();
  });

  it("keeps shader rings pending until the far-summary source is ready", () => {
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(scene, config(), unavailableSource(), {
      webGpuCompatibleMaterial: true,
    });

    const stats = controller.update(new THREE.Vector3(257.5, 0, -130.25));

    expect(stats.sourceReady).toBe(0);
    expect(stats.readyTiles).toBe(0);
    expect(stats.pendingTiles).toBe(2);
    expect(stats.snapUpdatesThisFrame).toBe(0);
    expect(stats.rebuiltTilesThisFrame).toBe(0);
    expect(stats.verticesBuiltThisFrame).toBe(0);
    expect(stats.trianglesBuiltThisFrame).toBe(0);

    controller.dispose();
  });

  it("keeps an explicit CPU-baked fallback path", () => {
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(
      scene,
      config({ maxRebuildsPerFrame: 2, shaderDisplacement: false }),
      readyFlatSource(),
      { webGpuCompatibleMaterial: true },
    );

    const stats = controller.update(new THREE.Vector3(128, 0, 128));

    expect(stats.shaderDisplacementEnabled).toBe(0);
    expect(stats.shaderDisplacedTiles).toBe(0);
    expect(stats.cpuBakedTiles).toBe(2);
    expect(stats.rebuiltTilesThisFrame).toBe(2);
    expect(stats.verticesBuiltThisFrame).toBeGreaterThan(0);
    expect(stats.trianglesBuiltThisFrame).toBeGreaterThan(0);

    controller.dispose();
  });
});
