import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import { DEFAULT_RIVER_MATERIAL_SETTINGS } from "./riverMaterialRuntime.js";
import {
  createRiverBankResidueBuildJob,
  RiverBankResidueOverlay,
  type RiverBankResidueSampler,
} from "./riverBankResidueOverlay.js";
import type { WaterField } from "./waterField.js";

const validMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 1,
  valid: true,
  cellSizeM: 20,
};

function makeSampler(): RiverBankResidueSampler {
  return {
    sampleRiver(x: number) {
      const wet = x > 0;
      return {
        waterY: wet ? 1 : -1,
        terrainY: 0,
        depth: wet ? 1 : 0,
        wetMask: wet ? 1 : 0,
        bodyKind: wet ? 3 : 0,
        shoreDistanceM: wet ? 1 : 0,
        flowX: 1,
        flowZ: 0,
        flowStrength: wet ? 0.8 : 0,
        bedDrop: wet ? 1 : 0,
      };
    },
    surfaceHeight: () => 0,
    surfaceNormalY: () => 1,
  };
}

function environmentQuery(): EnvironmentQuery {
  return {
    surfaceHeightBestEffort: vi.fn((_x: number, _z: number, hint?: number) => ({
      height: 0,
      meta: { ...validMeta, cellSizeM: hint ?? 0 },
    })),
    surfaceNormal: vi.fn((_x: number, _z: number, hint?: number) => ({
      x: 0,
      y: 1,
      z: 0,
      meta: { ...validMeta, cellSizeM: hint ?? 0 },
    })),
    materialWeights: vi.fn((_x: number, _z: number, hint?: number) => ({
      grass: 1,
      rock: 0,
      sand: 0,
      snow: 0,
      meta: { ...validMeta, cellSizeM: hint ?? 0 },
    })),
    water: vi.fn((x: number, _z: number, hint?: number) => ({
      waterY: x > 0 ? 1 : -1,
      carvedBedY: 0,
      depth: x > 0 ? 1 : 0,
      wetMask: x > 0 ? 1 : 0,
      shoreDistanceM: x > 0 ? 1 : 0,
      bodyKind: x > 0 ? 3 : 0,
      bodyId: x > 0 ? 1 : null,
      meta: { ...validMeta, cellSizeM: hint ?? 0 },
    })),
    river: vi.fn((x: number, _z: number, hint?: number) => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: x > 0 ? 0.8 : 0,
      bedDrop: x > 0 ? 1 : 0,
      rapidMask: 0,
      channelCenterWeight: x > 0 ? 1 : 0,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta: { ...validMeta, cellSizeM: hint ?? 0 },
    })),
    visibility: vi.fn((_x: number, _z: number, hint?: number) => ({
      sunVisibility: 1,
      meta: { ...validMeta, cellSizeM: hint ?? 0 },
    })),
  };
}

describe("river bank residue build job", () => {
  it("spreads sampling and geometry generation across bounded steps", () => {
    const job = createRiverBankResidueBuildJob(
      makeSampler(),
      DEFAULT_RIVER_MATERIAL_SETTINGS,
      0,
      0,
    );

    expect(job.step(1, 1)).toBeNull();

    let result = null;
    let steps = 1;
    while (!result && steps < 1_000) {
      result = job.step(1, 1);
      steps += 1;
    }

    expect(result).not.toBeNull();
    expect(steps).toBeGreaterThan(625);
    expect(result!.wet.drawCount).toBeGreaterThan(0);
    expect(result!.wet.positions.every(Number.isFinite)).toBe(true);
  });

  it("keeps the default scan slice within eight cells per frame", () => {
    const job = createRiverBankResidueBuildJob(
      makeSampler(),
      DEFAULT_RIVER_MATERIAL_SETTINGS,
      0,
      0,
    );
    let result = null;
    let steps = 0;

    while (!result && steps < 1_000) {
      result = job.step();
      steps += 1;
    }

    expect(result).not.toBeNull();
    expect(steps).toBeGreaterThanOrEqual(Math.ceil((25 * 25) / 8));
  });

  it("uses the active EnvironmentQuery and preserves the coarse hint", () => {
    const query = environmentQuery();
    const sampleForCellSize = vi.fn(() => {
      throw new Error("legacy field must not be sampled while the query is active");
    });
    const field = {
      sample: sampleForCellSize,
      sampleForCellSize,
    } as unknown as WaterField;
    const overlay = new RiverBankResidueOverlay(new THREE.Scene(), field, {
      minimumSampleHintM: 20,
      readEnvironmentQuery: () => query,
    });

    overlay.update(1, new THREE.Vector3());

    expect(query.water).toHaveBeenCalled();
    expect(query.river).toHaveBeenCalled();
    expect(
      (query.water as ReturnType<typeof vi.fn>).mock.calls.every(
        (call: unknown[]) => call[2] === 20,
      ),
    ).toBe(true);
    expect(sampleForCellSize).not.toHaveBeenCalled();
    expect(overlay.getSamplingStats().environmentSamples).toBeGreaterThan(0);
    expect(overlay.getSamplingStats().fallbackSamples).toBe(0);
    overlay.dispose();
  });
});
