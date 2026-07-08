import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolveFarClipmapConfig } from "./far_clipmap_config.js";
import { createFarClipmapController } from "./far_clipmap_controller.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

function config() {
  return resolveFarClipmapConfig({
    enabled: true,
    innerRadiusM: 64,
    outerRadiusM: 512,
    ringCount: 2,
    baseCellSizeM: 8,
    gridResolution: 17,
    snapSizeM: 64,
    maxRebuildsPerFrame: 0,
  });
}

function unavailableSource(): FarClipmapSource {
  return {
    isReady: () => false,
    sampleHeight: () => { throw new Error("CPU source must not be sampled by shader-displaced clipmap"); },
    sampleMaterial: () => 0,
    sampleBiome: () => 0,
    sampleWater: () => 0,
  };
}

describe("FarClipmapController shader displacement", () => {
  it("updates reusable WebGPU grids without CPU terrain geometry rebuilds", () => {
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(scene, config(), unavailableSource(), {
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
    expect(stats.shaderDisplacementEnabled).toBe(1);
    expect(stats.shaderDisplacedTiles).toBe(2);
    expect(stats.cpuBakedTiles).toBe(0);
    expect(stats.reusableGridTiles).toBe(2);
    expect(stats.snappedOriginX).toBe(256);
    expect(stats.snappedOriginZ).toBe(-192);
    expect(stats.snapErrorMaxM).toBeLessThan(64);

    controller.dispose();
  });
});
