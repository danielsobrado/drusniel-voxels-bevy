import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFarShellMetrics } from "../long-view/farShellMetrics.js";
import {
  applyFarSummaryQueryOverrides,
  farSummaryRingsForScene,
  initFarSummaryIntegration,
  prunePendingGpuEnrichment,
  resolveFarSummaryFrameInterval,
} from "./integration.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import type { FarSummaryRingRequest } from "./clipmap-rings.js";

describe("resolveFarSummaryFrameInterval", () => {
  it("uses the provided default when no query override is present", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams(), "farSummaryBuildInterval", 30)).toBe(30);
  });

  it("accepts a positive integer query override", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=12"), "farSummaryBuildInterval", 30)).toBe(12);
  });

  it("floors fractional values", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=12.9"), "farSummaryBuildInterval", 30)).toBe(12);
  });

  it("rejects invalid values and clamps the default to at least one", () => {
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=0"), "farSummaryBuildInterval", 0)).toBe(1);
    expect(resolveFarSummaryFrameInterval(new URLSearchParams("farSummaryBuildInterval=nope"), "farSummaryBuildInterval", 0)).toBe(1);
  });
});

describe("applyFarSummaryQueryOverrides", () => {
  it("overrides tile build count and build ms budget", () => {
    const config = applyFarSummaryQueryOverrides(
      DEFAULT_FAR_SUMMARY_CONFIG,
      new URLSearchParams("farSummaryMaxTileBuildsPerFrame=4&farSummaryMaxBuildMsPerFrame=6"),
    );

    expect(config.stream.maxTileBuildsPerFrame).toBe(4);
    expect(config.stream.maxBuildMsPerFrame).toBe(6);
  });
});

describe("farSummaryRingsForScene", () => {
  it("covers the continent unified clipmap inner band without changing other scenes", () => {
    const rings = DEFAULT_FAR_SUMMARY_CONFIG.rings;
    const unified = farSummaryRingsForScene(
      new URLSearchParams("scene=continent&farSummaryLayout=2"),
      rings,
    );

    expect(unified[0]?.startM).toBe(384);
    expect(rings[0]?.startM).toBe(1536);
    expect(farSummaryRingsForScene(new URLSearchParams("scene=continent"), rings)[0]?.startM).toBe(1536);
  });

  it("respects an explicit far clipmap inner radius", () => {
    const unified = farSummaryRingsForScene(
      new URLSearchParams("scene=continent&farSummaryLayout=2&farClipmapInnerRadius=768"),
      DEFAULT_FAR_SUMMARY_CONFIG.rings,
    );

    expect(unified[0]?.startM).toBe(768);
  });
});

describe("prunePendingGpuEnrichment", () => {
  it("drops obsolete pre-recenter work without discarding current required tiles", () => {
    const request = (x: number): FarSummaryRingRequest => ({
      ring: 0,
      key: { ring: 0, x, z: 2, cellSizeM: 32 },
      priority: 0,
      distanceToCamera: 0,
      distanceToPredictedCenter: 0,
    });
    const pending = new Map([
      ["0:1:2:32", { progress: 100 }],
      ["0:9:2:32", { progress: 900 }],
    ]);

    expect(prunePendingGpuEnrichment([request(9)], pending)).toBe(1);
    expect([...pending.keys()]).toEqual(["0:9:2:32"]);
  });
});

describe("far summary fallback publication", () => {
  const flatSampler: FarTerrainSampler = {
    sampleHeight: () => 50,
    sampleMaterial: () => 1,
    sampleCanopyCoverage: () => 0,
    sampleWaterCoverage: () => 0,
  };

  it("publishes fallback samples for one settled frame instead of accumulating startup misses", () => {
    const metrics = createFarShellMetrics();
    const integration = initFarSummaryIntegration({
      terrainSampler: flatSampler,
      farShellMetrics: metrics,
      config: {
        ...DEFAULT_FAR_SUMMARY_CONFIG,
        stream: {
          ...DEFAULT_FAR_SUMMARY_CONFIG.stream,
          maxTileBuildsPerFrame: 1000,
          maxTileCommitsPerFrame: 1000,
        },
      },
    });
    const camera = new THREE.PerspectiveCamera();

    integration.update(1, 1 / 60, camera);
    expect(metrics.farSummaryProceduralFallbackSamples).toBe(0);

    integration.sampler.sampleHeight(99999, 99999, 0);
    integration.update(2, 1 / 60, camera);
    expect(metrics.farSummaryProceduralFallbackSamples).toBe(1);

    integration.update(3, 1 / 60, camera);
    expect(metrics.farSummaryProceduralFallbackSamples).toBe(0);
    expect(metrics.farSummaryFallbackSamples).toBe(0);

    integration.dispose();
  });
});
