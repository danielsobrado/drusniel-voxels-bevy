import { describe, expect, it } from "vitest";
import {
  evaluateBiomeVisualAcceptance,
  type BiomeVisualRuntimeState,
} from "./biome-visual-acceptance-contract.js";
import {
  BIOME_VISUAL_SEASON_PROFILES,
  buildBiomeVisualAcceptanceUrl,
  type BiomeVisualSeason,
} from "./biome-visual-acceptance-profile.js";
import {
  deriveImageDifferenceMask,
  measureImageDelta,
  unionImageMasks,
  type ImageDeltaMetrics,
  type RgbaImage,
} from "./biome-visual-image-metrics.js";

function image(values: readonly number[]): RgbaImage {
  return {
    data: new Uint8Array(values),
    width: values.length / 4,
    height: 1,
    channels: 4,
  };
}

function runtimeState(season: BiomeVisualSeason): BiomeVisualRuntimeState {
  const profile = BIOME_VISUAL_SEASON_PROFILES[season];
  return {
    enabled: true,
    seasonT: profile.seasonT,
    green: profile.expected.green,
    autumn: profile.expected.autumn,
    bloom: profile.expected.bloom,
    snowlineM: profile.expected.snowlineM,
    frostAmount: profile.expected.frostAmount,
    wetness: 0,
  };
}

function delta(overrides: Partial<ImageDeltaMetrics> = {}): ImageDeltaMetrics {
  return {
    sampledPixels: 2_000,
    changedPixels: 1_500,
    changedRatio: 0.75,
    meanRgbDelta: 12,
    maxRgbDelta: 64,
    ...overrides,
  };
}

describe("biome visual acceptance", () => {
  it("builds deterministic infinite-islands keyframe URLs", () => {
    const url = new URL(buildBiomeVisualAcceptanceUrl("http://127.0.0.1:5180/", "7", 16, "autumn"));
    expect(url.searchParams.get("scene")).toBe("infinite-islands");
    expect(url.searchParams.get("seed")).toBe("7");
    expect(url.searchParams.get("biomeSeasonT")).toBe("0.75");
    expect(url.searchParams.get("acceptance")).toBe("1");
    expect(url.searchParams.get("weather")).toBe("off");
  });

  it("derives masks and measures only selected pixels", () => {
    const left = image([0, 0, 0, 255, 10, 10, 10, 255, 20, 20, 20, 255]);
    const right = image([0, 0, 0, 255, 20, 20, 20, 255, 40, 40, 40, 255]);
    const first = deriveImageDifferenceMask(left, right, 20);
    const second = new Uint8Array([0, 0, 1]);
    const mask = unionImageMasks(first, second);
    const metrics = measureImageDelta(left, right, mask, 20);

    expect(Array.from(mask)).toEqual([0, 1, 1]);
    expect(metrics.sampledPixels).toBe(2);
    expect(metrics.changedPixels).toBe(2);
    expect(metrics.meanRgbDelta).toBe(45);
  });

  it("passes exact keyframes with visible domain deltas", () => {
    const result = evaluateBiomeVisualAcceptance({
      runtimeStates: {
        winter: runtimeState("winter"),
        spring: runtimeState("spring"),
        summer: runtimeState("summer"),
        autumn: runtimeState("autumn"),
      },
      metrics: {
        terrainWinterSummer: delta(),
        grassWinterSummer: delta(),
        treesSummerAutumn: delta(),
        understorySummerAutumn: delta(),
        bloomSpringAutumn: delta(),
      },
      webGpuErrors: { winter: 0, spring: 0, summer: 0, autumn: 0 },
    });

    expect(result).toEqual({ passed: true, failures: [] });
  });

  it("fails stale runtime state, absent vegetation, missing diagnostics, and GPU errors", () => {
    const staleSummer = { ...runtimeState("summer"), green: 0.2 };
    const result = evaluateBiomeVisualAcceptance({
      runtimeStates: {
        winter: runtimeState("winter"),
        spring: runtimeState("spring"),
        summer: staleSummer,
        autumn: runtimeState("autumn"),
      },
      metrics: {
        terrainWinterSummer: delta(),
        grassWinterSummer: delta({ sampledPixels: 0, changedPixels: 0, changedRatio: 0, meanRgbDelta: 0 }),
        treesSummerAutumn: delta(),
        understorySummerAutumn: delta(),
        bloomSpringAutumn: delta(),
      },
      webGpuErrors: { winter: 0, spring: -1, summer: 0, autumn: 2 },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.includes("summer.green"))).toBe(true);
    expect(result.failures.some((failure) => failure.includes("grass winter/summer mask"))).toBe(true);
    expect(result.failures.some((failure) => failure.includes("spring: expected zero WebGPU errors"))).toBe(true);
    expect(result.failures.some((failure) => failure.includes("autumn: expected zero WebGPU errors"))).toBe(true);
  });
});
