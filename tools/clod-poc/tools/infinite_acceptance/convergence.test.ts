import { describe, expect, it } from "vitest";
import {
  cacheEvidenceFromTimings,
  convergenceTimeoutBlockers,
  evaluateConvergence,
  profileAcceptanceParams,
  type ConvergenceSnapshot,
} from "./convergence.js";

function snapshot(overrides: Partial<ConvergenceSnapshot> = {}): ConvergenceSnapshot {
  return {
    tilesMissing: 0,
    tilesBuilding: 0,
    farShellRebuildPending: 0,
    textureWindowPending: 0,
    bubbleBuilding: 0,
    bubbleReady: 1,
    bubbleRequired: 1,
    bubbleFailed: 0,
    bubbleRetryPages: 0,
    bubblePendingChunks: 0,
    bubbleInflightChunks: 0,
    streamRequired: 1,
    streamBudget: 1,
    streamPending: 0,
    streamInflight: 0,
    streamReady: 1,
    streamCached: 1,
    streamFailed: 0,
    proxyBuilding: 0,
    ...overrides,
  };
}

describe("infinite acceptance convergence helpers", () => {
  it("does not treat cached streamed roots as quiet while pending work remains", () => {
    expect(evaluateConvergence(snapshot({
      streamCached: 17,
      streamReady: 0,
      streamPending: 1,
    })).streamQuiet).toBe(false);
  });

  it("does not treat a required stream with zero build budget as quiet", () => {
    const result = evaluateConvergence(snapshot({
      streamRequired: 58,
      streamBudget: 0,
      streamReady: 0,
      streamCached: 0,
    }));
    const blockers = convergenceTimeoutBlockers(snapshot({
      streamRequired: 58,
      streamBudget: 0,
      streamReady: 0,
      streamCached: 0,
    }));

    expect(result.streamQuiet).toBe(false);
    expect(blockers[0]).toContain("clodStream: budget=0");
  });

  it("treats active resident roots as quiet when stream queues are empty", () => {
    expect(evaluateConvergence(snapshot({
      streamCached: 17,
      streamReady: 17,
      streamPending: 0,
      streamInflight: 0,
    })).streamQuiet).toBe(true);
  });

  it("prints live-bubble pending/building data in timeout blockers", () => {
    expect(convergenceTimeoutBlockers(snapshot({
      bubbleBuilding: 5,
      bubbleReady: 47,
      bubbleRequired: 52,
      bubblePendingChunks: 80,
      bubbleInflightChunks: 12,
    }))[0]).toContain("liveBubble: building=5 required=52 ready=47 pendingChunks=80 inflightChunks=12");
  });

  it("zeros stale cache boot evidence for reused scenes", () => {
    const cache = cacheEvidenceFromTimings({
      clod_cache_miss: 1,
      startup_build_world_ms: 1000,
      startup_terrain_summary_ms: 12,
      acceptance_world_reuse_mode: 3,
    }, true);

    expect(cache.page_reused).toBe(1);
    expect(cache.startup_reexecuted).toBe(0);
    expect(cache.clodCacheMiss).toBe(0);
    expect(cache.startupBuildWorldMs).toBe(0);
    expect(cache.startupTerrainSummaryMs).toBe(0);
  });

  it("passes higher acceptance warmup budgets by profile", () => {
    expect(profileAcceptanceParams("reuse")).toMatchObject({
      liveBubbleBudget: "4",
      liveBubbleGpuChunkBudget: "12",
      liveClodRootBudget: "2",
      liveClodRootMaxCached: "16",
      farSummaryMaxTileBuildsPerFrame: "4",
      farSummaryMaxBuildMsPerFrame: "6",
    });
    expect(profileAcceptanceParams("fast")).toMatchObject({
      liveBubbleBudget: "8",
      liveBubbleGpuChunkBudget: "16",
      liveClodRootBudget: "4",
      liveClodRootMaxCached: "24",
      farSummaryMaxTileBuildsPerFrame: "8",
      farSummaryMaxBuildMsPerFrame: "8",
    });
  });

  it("gives reuse a positive streamed CLOD budget and cache cap", () => {
    const params = profileAcceptanceParams("reuse");

    expect(Number(params["liveClodRootBudget"])).toBeGreaterThan(0);
    expect(Number(params["liveClodRootMaxCached"])).toBeGreaterThan(0);
  });
});
