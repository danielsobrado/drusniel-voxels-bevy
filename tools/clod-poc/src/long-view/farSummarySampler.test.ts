import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFarShellMetrics } from "./farShellMetrics.js";
import { sampleBlendedHeightNormalMaterial } from "./farSummarySampler.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";

function countingProvider(calls: { height: number; normal: number; material: number }, material = 2): FarHeightProvider {
  return {
    sampleHeight: () => {
      calls.height++;
      return 10;
    },
    sampleNormal: () => {
      calls.normal++;
      return new THREE.Vector3(0, 1, 0);
    },
    sampleMaterial: () => {
      calls.material++;
      return material;
    },
  };
}

describe("far summary sampler", () => {
  it("keeps provider biome material even in the macro horizon band", () => {
    const calls = { height: 0, normal: 0, material: 0 };
    const sample = sampleBlendedHeightNormalMaterial(
      1000,
      1000,
      20000,
      countingProvider(calls, 6),
      {
        macroBlendStartMeters: 8192,
        macroBlendEndMeters: 16384,
      },
    );

    expect(Number.isFinite(sample.height)).toBe(true);
    expect(sample.material).toBe(6);
    expect(calls.height).toBe(1);
    expect(calls.normal).toBe(1);
    expect(calls.material).toBe(1);
  });

  it("uses provider once per channel when summary data contributes", () => {
    const calls = { height: 0, normal: 0, material: 0 };
    const sample = sampleBlendedHeightNormalMaterial(
      1000,
      1000,
      4096,
      countingProvider(calls),
      {
        macroBlendStartMeters: 8192,
        macroBlendEndMeters: 16384,
      },
    );

    expect(sample.height).toBe(10);
    expect(sample.material).toBe(2);
    expect(calls.height).toBe(1);
    expect(calls.normal).toBe(1);
    expect(calls.material).toBe(1);
  });

  it("uses single-call provider sampling when available", () => {
    const calls = { summary: 0, height: 0, normal: 0, material: 0 };
    const provider: FarHeightProvider = {
      sampleSummaryInto: (_x, _z, _distance, out) => {
        calls.summary++;
        out.height = 12;
        out.normalX = 0;
        out.normalY = 1;
        out.normalZ = 0;
        out.material = 5;
        return true;
      },
      sampleHeight: () => {
        calls.height++;
        return 0;
      },
      sampleNormal: () => {
        calls.normal++;
        return new THREE.Vector3(0, 1, 0);
      },
      sampleMaterial: () => {
        calls.material++;
        return 0;
      },
    };

    const sample = sampleBlendedHeightNormalMaterial(1000, 1000, 4096, provider, {
      macroBlendStartMeters: 8192,
      macroBlendEndMeters: 16384,
      scratch: {
        providerSample: { height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0 },
        normal: new THREE.Vector3(0, 1, 0),
      },
    });

    expect(sample.height).toBe(12);
    expect(sample.material).toBe(5);
    expect(calls.summary).toBe(1);
    expect(calls.height).toBe(0);
    expect(calls.normal).toBe(0);
    expect(calls.material).toBe(0);
  });

  it("handles zero-width macro blend ranges", () => {
    const sample = sampleBlendedHeightNormalMaterial(0, 0, 10, undefined, {
      macroBlendStartMeters: 10,
      macroBlendEndMeters: 10,
    });

    expect(Number.isFinite(sample.height)).toBe(true);
    expect(Number.isFinite(sample.normal.x)).toBe(true);
  });

  it("falls back when provider returns invalid normals", () => {
    const metrics = createFarShellMetrics();
    const sample = sampleBlendedHeightNormalMaterial(0, 0, 0, {
      sampleHeight: () => 10,
      sampleNormal: () => new THREE.Vector3(Number.NaN, 0, 0),
    }, {
      macroBlendStartMeters: 1000,
      macroBlendEndMeters: 2000,
      metrics,
    });

    expect(Number.isFinite(sample.height)).toBe(true);
    expect(Number.isFinite(sample.normal.x)).toBe(true);
    expect(metrics.farSummaryFallbackSamples).toBe(1);
  });
});
