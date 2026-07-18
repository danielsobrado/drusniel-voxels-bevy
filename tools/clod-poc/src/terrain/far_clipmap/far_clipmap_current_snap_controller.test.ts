import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolveFarClipmapConfig } from "./far_clipmap_config.js";
import { createFarClipmapController } from "./index.js";
import { applyCurrentSnapReadiness } from "./far_clipmap_current_snap_controller.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

function config(ringCount = 1) {
  return resolveFarClipmapConfig({
    enabled: true,
    innerRadiusM: 64,
    outerRadiusM: 512,
    ringCount,
    baseCellSizeM: 8,
    gridResolution: 17,
    snapSizeM: 64,
    maxRebuildsPerFrame: 0,
    sourceRefreshMaxPerFrame: 1,
  });
}

function readyFlatSource(): FarClipmapSource {
  return {
    isReady: () => true,
    revision: () => 1,
    sampleHeight: () => 12,
    sampleMaterial: () => 1,
    sampleBiome: () => 1,
    sampleWater: () => 0,
  };
}

describe("current snap far clipmap readiness", () => {
  it("counts only rings committed for the requested snap", () => {
    const stats = {
      enabled: 1,
      ringCount: 3,
      snappedOriginX: 64,
      snappedOriginZ: -64,
      readyTiles: 3,
      pendingTiles: 0,
      gpuOwnedCells: 3,
      gpuOwnershipHoles: 0,
    } as Parameters<typeof applyCurrentSnapReadiness>[0];

    const adjusted = applyCurrentSnapReadiness(stats, [
      { readySnapX: 64, readySnapZ: -64 },
      { readySnapX: 0, readySnapZ: -64 },
      { readySnapX: Number.NaN, readySnapZ: Number.NaN },
    ]);

    expect(adjusted.readyTiles).toBe(1);
    expect(adjusted.pendingTiles).toBe(2);
    expect(adjusted.gpuOwnedCells).toBe(1);
    expect(adjusted.gpuOwnershipHoles).toBe(2);
  });

  it("keeps the old ring visible but pending until the replacement commits", () => {
    const scene = new THREE.Scene();
    const controller = createFarClipmapController(
      scene,
      config(),
      readyFlatSource(),
      { webGpuCompatibleMaterial: true },
    );

    expect(controller.update(new THREE.Vector3(63, 0, 0)).readyTiles).toBe(1);
    const oldMesh = scene.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.visible,
    );
    expect(oldMesh?.position.x).toBe(-512);

    const crossed = controller.update(new THREE.Vector3(65, 0, 0));
    expect(crossed.readyTiles).toBe(0);
    expect(crossed.pendingTiles).toBe(1);
    expect(crossed.gpuOwnershipHoles).toBe(1);
    expect(oldMesh?.visible).toBe(true);
    expect(oldMesh?.position.x).toBe(-512);
    expect(controller.ownershipSnapshot().ready).toBe(false);

    controller.commitPendingUpload();
    controller.commitPendingUpload();
    controller.commitPendingUpload();
    const committed = controller.update(new THREE.Vector3(65, 0, 0));

    expect(committed.readyTiles).toBe(1);
    expect(committed.pendingTiles).toBe(0);
    expect(committed.gpuOwnershipHoles).toBe(0);
    expect(controller.ownershipSnapshot().ready).toBe(true);
    controller.dispose();
  });

  it("keeps a current snap ready during source-only refreshes", () => {
    let revision = 1;
    const source: FarClipmapSource = {
      ...readyFlatSource(),
      revision: () => revision,
    };
    const controller = createFarClipmapController(
      new THREE.Scene(),
      resolveFarClipmapConfig({
        ...config(),
        ringCount: 1,
        sourceRefreshIntervalFrames: 1,
      }),
      source,
      { webGpuCompatibleMaterial: true },
    );
    const center = new THREE.Vector3(0, 0, 0);

    expect(controller.update(center).readyTiles).toBe(1);
    revision = 2;
    const refreshed = controller.update(center);

    expect(refreshed.readyTiles).toBe(1);
    expect(refreshed.pendingTiles).toBe(0);
    expect(controller.ownershipSnapshot().ready).toBe(true);
    controller.dispose();
  });
});
