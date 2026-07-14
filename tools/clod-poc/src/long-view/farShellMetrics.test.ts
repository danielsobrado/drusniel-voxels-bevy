import { describe, expect, it } from "vitest";
import { createFarShellMetrics, publishFarShellMetricsToCounters } from "./farShellMetrics.js";

describe("far-summary enrichment metrics", () => {
  it("publishes terrain/water and canopy readiness independently", () => {
    const metrics = createFarShellMetrics();
    metrics.farSummaryTerrainWaterReady = 7;
    metrics.farSummaryWaterPending = 3;
    metrics.farSummaryCanopyPending = 2;
    metrics.farSummaryFullyEnriched = 5;
    const counters: Record<string, number> = {};

    publishFarShellMetricsToCounters(counters, metrics);

    expect(counters).toMatchObject({
      far_summary_terrain_water_ready: 7,
      far_summary_water_pending: 3,
      far_summary_canopy_pending: 2,
      far_summary_fully_enriched: 5,
    });
  });
});
