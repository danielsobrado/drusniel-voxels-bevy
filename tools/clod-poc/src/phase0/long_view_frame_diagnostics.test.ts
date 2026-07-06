import { describe, expect, it } from "vitest";
import { packLiveKey } from "../stream/live_chunk_keys.js";
import { packPageKey, pageKey } from "../stream/page_plan.js";
import type { TerrainOwnershipRuntimeSnapshot } from "../stream/terrain_ownership_runtime.js";
import type { OwnershipResidencyFeeds } from "../stream/ownership_residency.js";
import { requiredRootClodPagesReady, streamReadinessSatisfied } from "./long_view_frame_diagnostics.js";

function snapshot(): TerrainOwnershipRuntimeSnapshot {
  return {
    center: { x: 0, z: 0 },
    live: {
      center: { x: 0, z: 0 },
      required: ["0,0"],
      loaded: [],
      evictable: [],
    },
    visualPages: {
      center: { x: 0, z: 0 },
      required: [pageKey(2, 0, 0), pageKey(1, 0, 0), pageKey(0, 1, 1)],
      loaded: [],
      evictable: [],
    },
    ownership: { liveRadiusM: 32, clodRadiusM: 128 },
    farShell: { innerRadiusM: 128, outerRadiusM: 512 },
  };
}

function feeds(liveReady: ReadonlySet<number>, clodReady: ReadonlySet<number>): OwnershipResidencyFeeds {
  return {
    liveReady: () => liveReady,
    clodReady: () => clodReady,
  };
}

describe("stream readiness diagnostics", () => {
  it("requires coarsest CLOD pages to be resident, not every descendant", () => {
    const snap = snapshot();

    expect(requiredRootClodPagesReady(snap, feeds(new Set(), new Set()), 2, 2)).toBe(false);
    expect(requiredRootClodPagesReady(snap, feeds(new Set(), new Set([packPageKey(2, 0, 0)])), 2, 2)).toBe(true);
  });

  it("reports stream readiness after live roots and far-summary requests are ready", () => {
    const snap = snapshot();
    const readyFeeds = feeds(new Set([packLiveKey(0, 0)]), new Set([packPageKey(2, 0, 0)]));
    const readyCounters = {
      farSummaryTilesRequired: 4,
      farSummaryTilesReady: 4,
      farSummaryTilesMissing: 0,
      farSummaryTilesBuilding: 0,
      streamRequiredPages: 1,
      streamSafetyPendingPages: 0,
      streamSafetyInflightPages: 0,
      streamParentCoverageViolations: 0,
      streamActiveRootPages: 1,
    };

    expect(streamReadinessSatisfied({
      snapshot: snap,
      feeds: readyFeeds,
      requiredRootLevel: 2,
      coverageMaxLevel: 2,
      liveMissing: 1,
      counters: readyCounters,
    })).toBe(false);

    expect(streamReadinessSatisfied({
      snapshot: snap,
      feeds: feeds(new Set([packLiveKey(0, 0)]), new Set()),
      requiredRootLevel: 2,
      coverageMaxLevel: 2,
      liveMissing: 0,
      counters: readyCounters,
    })).toBe(true);

    expect(streamReadinessSatisfied({
      snapshot: snap,
      feeds: readyFeeds,
      requiredRootLevel: 2,
      coverageMaxLevel: 2,
      liveMissing: 0,
      counters: {
        farSummaryTilesRequired: 4,
        farSummaryTilesReady: 3,
        farSummaryTilesMissing: 0,
        farSummaryTilesBuilding: 0,
        streamRequiredPages: 1,
        streamSafetyPendingPages: 0,
        streamSafetyInflightPages: 0,
        streamParentCoverageViolations: 0,
        streamActiveRootPages: 1,
      },
    })).toBe(false);

    expect(streamReadinessSatisfied({
      snapshot: snap,
      feeds: readyFeeds,
      requiredRootLevel: 2,
      coverageMaxLevel: 2,
      liveMissing: 0,
      counters: readyCounters,
    })).toBe(true);
  });
});
