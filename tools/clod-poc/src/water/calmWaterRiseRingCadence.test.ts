import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CalmWaterRiseRingOverlay } from "./calmWaterRiseRingOverlay.js";
import { DEFAULT_CALM_WATER_RISE_RING_SETTINGS } from "./calmWaterRiseRingsRuntime.js";
import { HYDROLOGY_BODY_LAKE } from "./hydrologyGrid.js";
import type { WaterField, WaterFieldResult } from "./waterField.js";

function calmSample(): WaterFieldResult {
  return {
    waterY: 10,
    terrainY: 8,
    depth: 2,
    bodyMask: 1,
    bodyKind: HYDROLOGY_BODY_LAKE,
    shoreDistance: 12,
    flow: { x: 0, z: 0, speed: 0, progress: 0, drop: 0 },
  };
}

describe("calm-water rise-ring scan cadence", () => {
  it("waits for the configured interval after a completed scan", () => {
    const sampleForCellSize = vi.fn(() => calmSample());
    const overlay = new CalmWaterRiseRingOverlay(
      new THREE.Scene(),
      {
        sample: sampleForCellSize,
        sampleForCellSize,
      } as unknown as WaterField,
      {
        readEnvironmentQuery: () => null,
        settings: {
          ...DEFAULT_CALM_WATER_RISE_RING_SETTINGS,
          strength: 0,
          scanIntervalS: 1,
          scanGrid: 5,
          cellsPerFrame: 25,
          spawnRadiusM: 180,
        },
      },
    );

    overlay.update(1, new THREE.Vector3());
    const firstScanSamples = sampleForCellSize.mock.calls.length;
    expect(firstScanSamples).toBe(25);

    overlay.update(0.5, new THREE.Vector3());
    expect(sampleForCellSize).toHaveBeenCalledTimes(firstScanSamples);

    overlay.update(0.5, new THREE.Vector3());
    expect(sampleForCellSize).toHaveBeenCalledTimes(firstScanSamples * 2);
    overlay.dispose();
  });
});
