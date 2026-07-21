import { describe, expect, it } from "vitest";
import { compareWaterFoamToFableReference } from "./water-foam-reference-contract.js";
import {
  assertWaterFoamReferenceManifest,
  type WaterFoamReferenceManifest,
  type WaterFoamReferenceSourceKind,
} from "./water-foam-reference-manifest.js";

const HASH = "a".repeat(64);

function manifest(
  kind: WaterFoamReferenceSourceKind,
  overrides: {
    readonly rapidActive?: number;
    readonly smoothActive?: number;
    readonly stripe?: number;
    readonly lightingMean?: number;
  } = {},
): WaterFoamReferenceManifest {
  const image = (activeFraction: number) => ({
    waterPixelCount: 20_000,
    activePixelCount: Math.round(activeFraction * 20_000),
    meanCoverage: activeFraction * 0.45,
    activeFraction,
    isolatedActiveFraction: 0.05,
    componentDensityPerK: 8,
    largestComponentFraction: 0.42,
    stripeAnisotropy: overrides.stripe ?? 0.30,
  });
  const files = { waterMaskSha256: HASH, foamASha256: HASH };
  return {
    schemaVersion: 1,
    source: {
      kind,
      repository: kind === "fable5-world-demo" ? "Braffolk/fable5-world-demo" : "danielsobrado/drusniel-voxels-bevy",
      commit: "1".repeat(40),
      renderer: "webgpu",
      capturedAt: "2026-07-20T12:00:00.000Z",
    },
    scenes: {
      rapid: {
        width: 1280,
        height: 720,
        image: image(overrides.rapidActive ?? 0.20),
        temporal: { comparedPixelCount: 20_000, meanAbsoluteDelta: 0.025, binaryIou: 0.62 },
        lighting: {
          sampleCount: 2_000,
          meanLuminance: overrides.lightingMean ?? 0.58,
          p95Luminance: 0.82,
          standardDeviation: 0.12,
        },
        files: { ...files, foamBSha256: HASH, finalSha256: HASH },
      },
      smoothRiver: {
        width: 1280,
        height: 720,
        image: image(overrides.smoothActive ?? 0.04),
        files,
      },
      lakeShore: {
        width: 1280,
        height: 720,
        image: image(0.08),
        files,
      },
    },
  };
}

describe("Fable5 water foam reference gate", () => {
  it("passes matching normalized evidence", () => {
    const result = compareWaterFoamToFableReference(
      manifest("fable5-world-demo"),
      manifest("drusniel-clod-poc"),
    );

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.differences.length).toBeGreaterThan(20);
  });

  it("rejects coverage, stripe, lighting and rapid separation drift", () => {
    const result = compareWaterFoamToFableReference(
      manifest("fable5-world-demo"),
      manifest("drusniel-clod-poc", {
        rapidActive: 0.07,
        smoothActive: 0.06,
        stripe: 0.55,
        lightingMean: 0.82,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/rapid\.activeFraction/);
    expect(result.failures.join("\n")).toMatch(/stripeAnisotropy/);
    expect(result.failures.join("\n")).toMatch(/meanLuminance/);
    expect(result.failures.join("\n")).toMatch(/rapidToSmooth/);
  });

  it("requires canonical source roles and matching capture dimensions", () => {
    expect(() => compareWaterFoamToFableReference(
      manifest("drusniel-clod-poc"),
      manifest("drusniel-clod-poc"),
    )).toThrow(/requires fable5-world-demo/);

    const candidate = manifest("drusniel-clod-poc");
    const mismatched: WaterFoamReferenceManifest = {
      ...candidate,
      scenes: {
        ...candidate.scenes,
        rapid: { ...candidate.scenes.rapid, width: 640 },
      },
    };
    expect(() => compareWaterFoamToFableReference(
      manifest("fable5-world-demo"),
      mismatched,
    )).toThrow(/dimensions/);
  });

  it("validates evidence hashes, source commit and rapid evidence", () => {
    const valid = manifest("fable5-world-demo");
    expect(() => assertWaterFoamReferenceManifest(valid)).not.toThrow();
    expect(() => assertWaterFoamReferenceManifest({
      ...valid,
      source: { ...valid.source, commit: "short" },
    })).toThrow(/40-character Git SHA/);
    expect(() => assertWaterFoamReferenceManifest({
      ...valid,
      scenes: {
        ...valid.scenes,
        rapid: { ...valid.scenes.rapid, temporal: undefined },
      },
    })).toThrow(/requires temporal/);
  });
});
