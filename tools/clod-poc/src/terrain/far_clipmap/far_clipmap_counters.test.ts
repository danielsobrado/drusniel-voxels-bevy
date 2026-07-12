import { describe, expect, it } from "vitest";
import type { FarClipmapStats } from "./far_clipmap_controller.js";
import { publishFarClipmapStatsToCounters } from "./far_clipmap_counters.js";

function stats(overrides: Partial<FarClipmapStats> = {}): FarClipmapStats {
  return {
    enabled: 1,
    visible: 1,
    ringCount: 3,
    activeTiles: 3,
    readyTiles: 3,
    pendingTiles: 0,
    rebuiltTilesThisFrame: 0,
    snapUpdatesThisFrame: 3,
    sourceRefreshesThisFrame: 1,
    sourceRefreshesTotal: 4,
    sourceRefreshMsThisFrame: 0.5,
    sourceRefreshMsTotal: 2.5,
    sourceRevision: 42,
    innerRadiusM: 256,
    outerRadiusM: 4096,
    snapSizeM: 128,
    centerX: 513,
    centerZ: -257,
    snappedOriginX: 512,
    snappedOriginZ: -384,
    snapErrorXM: 1,
    snapErrorZM: 127,
    snapErrorMaxM: 127,
    shaderDisplacementEnabled: 1,
    shaderDisplacedTiles: 3,
    cpuBakedTiles: 0,
    reusableGridTiles: 3,
    geometryCreatesTotal: 3,
    geometryDisposalsTotal: 0,
    gpuOwnedCells: 3,
    gpuOwnershipHoles: 0,
    sourceReady: 0,
    buildMsThisFrame: 0,
    buildMsTotal: 0,
    verticesBuiltThisFrame: 0,
    trianglesBuiltThisFrame: 0,
    fallbackSamplesThisFrame: 0,
    fallbackSamplesTotal: 0,
    exceptionSamplesThisFrame: 0,
    exceptionSamplesTotal: 0,
    ...overrides,
  };
}

describe("publishFarClipmapStatsToCounters", () => {
  it("publishes shader-displaced far clipmap counters without a new grid namespace", () => {
    const counters: Record<string, number> = {};
    publishFarClipmapStatsToCounters(counters, stats());

    expect(counters["far_clipmap_shader_displacement_enabled"]).toBe(1);
    expect(counters["far_clipmap_shader_displaced_tiles"]).toBe(3);
    expect(counters["far_clipmap_cpu_baked_tiles"]).toBe(0);
    expect(counters["far_clipmap_reusable_grid_tiles"]).toBe(3);
    expect(counters["far_clipmap_source_refreshes_this_frame"]).toBe(1);
    expect(counters["far_clipmap_source_refreshes_total"]).toBe(4);
    expect(counters["far_clipmap_source_refresh_ms"]).toBe(0.5);
    expect(counters["far_clipmap_source_revision"]).toBe(42);
    expect(counters["far_clipmap_vertices_built_this_frame"]).toBe(0);
    expect(counters["far_clipmap_triangles_built_this_frame"]).toBe(0);
    expect(counters["far_clipmap_center_x"]).toBe(513);
    expect(counters["far_clipmap_snapped_origin_z"]).toBe(-384);
    expect(Object.keys(counters).some((key) => key.startsWith("far_clipmap_grid_"))).toBe(false);
  });

  it("excludes startup fallback samples and counts fallback after stream readiness", () => {
    const counters: Record<string, number> = { stream_ready_frame: -1 };

    publishFarClipmapStatsToCounters(counters, stats({
      sourceReady: 1,
      fallbackSamplesTotal: 90_000,
    }));
    expect(counters["far_clipmap_fallback_samples_lifetime_total"]).toBe(90_000);
    expect(counters["far_clipmap_fallback_samples_total"]).toBe(0);

    counters["stream_ready_frame"] = 42;
    publishFarClipmapStatsToCounters(counters, stats({
      sourceReady: 1,
      fallbackSamplesTotal: 90_001,
    }));
    expect(counters["far_clipmap_fallback_samples_total"]).toBe(1);

    publishFarClipmapStatsToCounters(counters, stats({
      sourceReady: 1,
      fallbackSamplesTotal: 90_003,
    }));
    expect(counters["far_clipmap_fallback_samples_lifetime_total"]).toBe(90_003);
    expect(counters["far_clipmap_fallback_samples_total"]).toBe(3);
  });

  it("starts a new fallback epoch when acceptance resets stream readiness", () => {
    const counters: Record<string, number> = { stream_ready_frame: 10 };

    publishFarClipmapStatsToCounters(counters, stats({ sourceReady: 1, fallbackSamplesTotal: 100 }));
    publishFarClipmapStatsToCounters(counters, stats({ sourceReady: 1, fallbackSamplesTotal: 102 }));
    expect(counters["far_clipmap_fallback_samples_total"]).toBe(2);

    counters["stream_ready_frame"] = -1;
    publishFarClipmapStatsToCounters(counters, stats({ sourceReady: 1, fallbackSamplesTotal: 120 }));
    expect(counters["far_clipmap_fallback_samples_total"]).toBe(0);

    counters["stream_ready_frame"] = 50;
    publishFarClipmapStatsToCounters(counters, stats({ sourceReady: 1, fallbackSamplesTotal: 120 }));
    publishFarClipmapStatsToCounters(counters, stats({ sourceReady: 1, fallbackSamplesTotal: 121 }));
    expect(counters["far_clipmap_fallback_samples_total"]).toBe(1);
  });
});
