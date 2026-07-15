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

function readyFlatSource(revision = 0): FarClipmapSource {
  return {
    isReady: () => true,
    revision: () => revision,
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

    expect(stats.readyTiles).toBe(1);
    expect(stats.pendingTiles).toBe(1);
    expect(stats.snapUpdatesThisFrame).toBe(1);
    expect(stats.sourceRefreshesThisFrame).toBe(1);
    expect(stats.sourceRefreshesTotal).toBe(1);
    expect(stats.rebuiltTilesThisFrame).toBe(0);
    expect(stats.verticesBuiltThisFrame).toBe(0);
    expect(stats.trianglesBuiltThisFrame).toBe(0);
    expect(stats.buildMsThisFrame).toBe(0);
    expect(stats.sourceRefreshMsThisFrame).toBeGreaterThanOrEqual(0);
    expect(stats.fallbackSamplesThisFrame).toBeGreaterThan(0);
    expect(stats.shaderDisplacementEnabled).toBe(1);
    expect(stats.shaderDisplacedTiles).toBe(2);
    expect(stats.cpuBakedTiles).toBe(0);
    expect(stats.reusableGridTiles).toBe(2);
    expect(stats.snappedOriginX).toBe(256);
    expect(stats.snappedOriginZ).toBe(-192);
    expect(stats.snapErrorMaxM).toBeLessThan(64);

    const caughtUp = controller.update(new THREE.Vector3(257.5, 0, -130.25));
    expect(caughtUp.readyTiles).toBe(2);
    expect(caughtUp.pendingTiles).toBe(0);
    expect(caughtUp.sourceRefreshesThisFrame).toBe(1);

    controller.dispose();
  });

  it("uploads unified water level, body kind, shore distance, and coverage", () => {
    const source: FarClipmapSource = {
      ...readyFlatSource(),
      sampleSummaryInto: (_x, _z, _distanceM, out) => {
        out.height = 12;
        out.normalX = 0;
        out.normalY = 1;
        out.normalZ = 0;
        out.material = 1;
        out.waterLevel = 34;
        out.bodyKind = 2;
        out.shoreDistance = 80;
        out.waterCoverage = 0.75;
        out.unifiedChannels = true;
        return true;
      },
    };
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(scene, config({ ringCount: 1 }), source, {
      webGpuCompatibleMaterial: true,
    });

    const stats = controller.update(new THREE.Vector3(0, 0, 0));
    const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const material = mesh?.material as THREE.Material | undefined;
    const sourceData = material?.userData.farClipmapSourceData as Float32Array | undefined;
    const waterData = material?.userData.farClipmapWaterData as Float32Array | undefined;

    expect(stats.fallbackSamplesThisFrame).toBe(0);
    const centerOffset = (8 * 17 + 8) * 4;
    expect(sourceData?.[centerOffset + 3]).toBe(1);
    expect(waterData?.slice(centerOffset, centerOffset + 4)).toEqual(new Float32Array([34, 2, 80, 0.75]));

    controller.dispose();
  });

  it("marks layout-v1 summary water as non-authoritative", () => {
    const source: FarClipmapSource = {
      ...readyFlatSource(),
      sampleSummaryInto: (_x, _z, _distanceM, out) => {
        out.height = 12;
        out.normalX = 0;
        out.normalY = 1;
        out.normalZ = 0;
        out.material = 1;
        out.waterCoverage = 1;
        out.waterLevel = 0;
        out.unifiedChannels = false;
        return true;
      },
    };
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(scene, config({ ringCount: 1 }), source, {
      webGpuCompatibleMaterial: true,
    });

    controller.update(new THREE.Vector3(0, 0, 0));
    const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const material = mesh?.material as THREE.Material | undefined;
    const waterData = material?.userData.farClipmapWaterData as Float32Array | undefined;

    const centerOffset = (8 * 17 + 8) * 4;
    expect(waterData?.[centerOffset + 3]).toBe(-1);
    controller.dispose();
  });

  it("floors revision-driven stable-ring refreshes by the per-ring interval, then catches up", () => {
    let revision = 1;
    const source: FarClipmapSource = {
      isReady: () => true,
      revision: () => revision,
      sampleHeight: () => 12,
      sampleMaterial: () => 1,
      sampleBiome: () => 1,
      sampleWater: () => 0,
    };
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(
      scene,
      config({ sourceRefreshMaxPerFrame: 1, sourceRefreshIntervalFrames: 3 }),
      source,
      { webGpuCompatibleMaterial: true },
    );
    const center = new THREE.Vector3(257.5, 0, -130.25);

    controller.update(center);
    controller.update(center); // source-refresh budget primes one ring per frame
    revision = 2;
    // A revision bump inside the interval must NOT re-sample the ring textures — during
    // traversal the far-summary revision bumps almost every frame, and per-bump full
    // resamples were a steady ~1-2ms/frame CPU cost for imperceptible far-band change.
    const deferred = controller.update(center);
    const stillDeferred = controller.update(center);
    const firstRefresh = controller.update(center);
    const secondRefresh = controller.update(center);

    expect(deferred.snapUpdatesThisFrame).toBe(0);
    expect(deferred.sourceRefreshesThisFrame).toBe(0);
    expect(stillDeferred.sourceRefreshesThisFrame).toBe(1);
    expect(stillDeferred.sourceRevision).toBe(2);
    expect(firstRefresh.sourceRefreshesThisFrame).toBe(1);
    expect(firstRefresh.sourceRevision).toBe(2);
    expect(secondRefresh.sourceRefreshesThisFrame).toBe(0);
    expect(secondRefresh.sourceRefreshesTotal).toBe(4);

    controller.dispose();
  });

  it("does not poll an unchanged authoritative revision source", () => {
    const source: FarClipmapSource = {
      isReady: () => true,
      revision: () => 1,
      revisionIsAuthoritative: () => true,
      sampleHeight: () => 12,
      sampleMaterial: () => 1,
      sampleBiome: () => 1,
      sampleWater: () => 0,
    };
    const controller = createFarClipmapController(
      new THREE.Scene(),
      config({ sourceRefreshMaxPerFrame: 1, sourceRefreshIntervalFrames: 1 }),
      source,
      { webGpuCompatibleMaterial: true },
    );
    const center = new THREE.Vector3(257.5, 0, -130.25);
    controller.update(center);
    controller.update(center);

    expect(controller.update(center).sourceRefreshesThisFrame).toBe(0);
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
    expect(stats.sourceRefreshesThisFrame).toBe(0);
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
    expect(stats.sourceRefreshesThisFrame).toBe(0);
    expect(stats.verticesBuiltThisFrame).toBeGreaterThan(0);
    expect(stats.trianglesBuiltThisFrame).toBeGreaterThan(0);

    controller.dispose();
  });
});
