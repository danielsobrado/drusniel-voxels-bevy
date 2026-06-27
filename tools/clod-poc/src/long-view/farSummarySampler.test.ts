import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFarShellMetrics } from "./farShellMetrics.js";
import { sampleBlendedHeightNormalMaterial } from "./farSummarySampler.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";

function countingProvider(calls: { height: number; normal: number; material: number }): FarHeightProvider {
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
      return 2;
    },
  };
}

describe("far summary sampler", () => {
  it("skips provider calls in the macro-only band", () => {
    const calls = { height: 0, normal: 0, material: 0 };
    const sample = sampleBlendedHeightNormalMaterial(
      1000,
      1000,
      20000,
      countingProvider(calls),
      {
        macroBlendStartMeters: 8192,
        macroBlendEndMeters: 16384,
      },
    );

    expect(Number.isFinite(sample.height)).toBe(true);
    expect(calls.height).toBe(0);
    expect(calls.normal).toBe(0);
    expect(calls.material).toBe(0);
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
