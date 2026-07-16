import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { StreamCursor } from "../stream/stream_cursor.js";

function stationaryCursor(frameId: number): StreamCursor {
  return {
    frameId,
    center: { x: 0, z: 0 },
    velocityMps: { x: 0, z: 0 },
    deltaSeconds: 1 / 60,
    source: "orbit_target",
    predicted: () => ({ x: 0, z: 0 }),
  };
}

afterEach(() => vi.unstubAllGlobals());

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

  it("uses the shared stream cursor velocity and prediction", () => {
    const integration = initFarSummaryIntegration({ terrainSampler: flatSampler });
    const camera = new THREE.PerspectiveCamera();
    integration.update(1, camera, {
      frameId: 1,
      center: { x: 100, z: 200 },
      velocityMps: { x: 12, z: -3 },
      deltaSeconds: 1 / 30,
      source: "orbit_target",
      predicted: (aheadSeconds) => ({ x: 100 + 12 * aheadSeconds, z: 200 - 3 * aheadSeconds }),
    });

    expect(integration.getStreamCenter()).toEqual({
      worldX: 100,
      worldZ: 200,
      predictedX: 148,
      predictedZ: 188,
      velocityX: 12,
      velocityZ: -3,
    });
    integration.dispose();
  });

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

    integration.update(1, camera, stationaryCursor(1));
    expect(metrics.farSummaryProceduralFallbackSamples).toBe(0);

    integration.sampler.sampleHeight(99999, 99999, 0);
    integration.update(2, camera, stationaryCursor(2));
    expect(metrics.farSummaryProceduralFallbackSamples).toBe(1);

    integration.update(3, camera, stationaryCursor(3));
    expect(metrics.farSummaryProceduralFallbackSamples).toBe(0);
    expect(metrics.farSummaryFallbackSamples).toBe(0);

    integration.dispose();
  });

  it("stages CPU unified tiles through water-ready snapshots before canopy completion", () => {
    vi.stubGlobal("window", { location: { search: "?farSummaryLayout=2&farSummaryGpu=0" } });
    const metrics = createFarShellMetrics();
    let waterCalls = 0;
    let canopyCalls = 0;
    const integration = initFarSummaryIntegration({
      terrainSampler: {
        ...flatSampler,
        sampleWaterSummary: () => {
          waterCalls++;
          return { coverage: 0, waterLevel: 0, bodyKind: 0, shoreDistance: 10, flowX: 0, flowZ: 0 };
        },
        sampleCanopySummary: () => {
          canopyCalls++;
          const until = performance.now() + 0.25;
          while (performance.now() < until) {
            // Model the real stratified canopy source so the staged snapshot is observable.
          }
          return {
            coverage: 0.5,
            canopyHeightAvg: 60,
            speciesPine: 1,
            speciesBroadleaf: 0,
            speciesDeadwood: 0,
          };
        },
      },
      farShellMetrics: metrics,
      config: {
        ...DEFAULT_FAR_SUMMARY_CONFIG,
        stream: {
          ...DEFAULT_FAR_SUMMARY_CONFIG.stream,
          maxTileBuildsPerFrame: 1,
          warmupMaxTileBuildsPerFrame: 1,
          maxBuildMsPerFrame: 0,
          warmupMaxBuildMsPerFrame: 0,
        },
      },
    });
    const camera = new THREE.PerspectiveCamera();
    let observedSplitReadiness = false;

    for (let frame = 1; frame <= 80 && !observedSplitReadiness; frame++) {
      integration.update(frame, camera, stationaryCursor(frame));
      observedSplitReadiness = (metrics.farSummaryTerrainWaterReady ?? 0) > 0
        && (metrics.farSummaryCanopyPending ?? 0) > 0
        && (metrics.farSummaryFullyEnriched ?? 0) < (metrics.farSummaryTerrainWaterReady ?? 0);
    }

    expect(observedSplitReadiness).toBe(true);
    expect(waterCalls).toBeGreaterThan(0);
    expect(canopyCalls).toBeGreaterThan(0);
    integration.dispose();
  });
});
