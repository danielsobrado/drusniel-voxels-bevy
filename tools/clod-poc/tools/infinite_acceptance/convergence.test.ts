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
    streamMaxCached: 512,
    streamSafetyCacheCapacityOk: 1,
    streamSafetyRequired: 1,
    streamSafetyReady: 1,
    streamSafetyPending: 0,
    streamSafetyInflight: 0,
    streamRefinementPending: 0,
    streamRefinementInflight: 0,
    streamParentCoverageViolations: 0,
    streamActiveRootPages: 1,
    streamReadyFrame: 1,
    streamReadyFrontierM: 384,
    farClipmapInnerRadiusM: 384,
    heightfieldEnabled: 1,
    heightfieldPending: 0,
    heightfieldInflight: 0,
    heightfieldFallbackSamples: 0,
    proxyBuilding: 0,
    sceneCompileRequired: 0,
    sceneCompilePending: 0,
    sceneCompileReady: 1,
    ...overrides,
  };
}

describe("infinite acceptance convergence helpers", () => {
  it("accepts a settled far summary when the scene omits the optional building counter", () => {
    const result = evaluateConvergence(snapshot({ tilesMissing: 0, tilesBuilding: -1 }));

    expect(result.farSummaryQuiet).toBe(true);
    expect(result.quiet).toBe(true);
  });

  it("waits for an explicitly requested scene pipeline prewarm", () => {
    expect(evaluateConvergence(snapshot({
      sceneCompileRequired: 1,
      sceneCompilePending: 1,
      sceneCompileReady: 0,
    })).quiet).toBe(false);
    expect(evaluateConvergence(snapshot({
      sceneCompileRequired: 1,
      sceneCompilePending: 0,
      sceneCompileReady: 1,
    })).quiet).toBe(true);
  });

  it("does not treat cached streamed roots as quiet while pending work remains", () => {
    expect(evaluateConvergence(snapshot({
      streamCached: 17,
      streamReady: 0,
      streamPending: 1,
      streamSafetyReady: 0,
      streamSafetyPending: 1,
      streamParentCoverageViolations: 1,
      streamActiveRootPages: 0,
    })).streamQuiet).toBe(false);
  });

  it("does not treat a required stream with zero build budget as quiet", () => {
    const result = evaluateConvergence(snapshot({
      streamRequired: 58,
      streamBudget: 0,
      streamReady: 0,
      streamCached: 0,
      streamSafetyReady: 0,
      streamParentCoverageViolations: 1,
      streamActiveRootPages: 0,
    }));
    const blockers = convergenceTimeoutBlockers(snapshot({
      streamRequired: 58,
      streamBudget: 0,
      streamReady: 0,
      streamCached: 0,
      streamSafetyReady: 0,
      streamParentCoverageViolations: 1,
      streamActiveRootPages: 0,
    }));

    expect(result.streamQuiet).toBe(false);
    expect(blockers[0]).toContain("clodStream: budget=0");
  });

  it("does not wait when the CLOD safety set cannot fit cache", () => {
    const result = evaluateConvergence(snapshot({
      streamRequired: 4230,
      streamMaxCached: 256,
      streamSafetyCacheCapacityOk: 0,
      streamSafetyRequired: 874,
      streamSafetyReady: 256,
      streamSafetyPending: 616,
      streamParentCoverageViolations: 618,
      streamActiveRootPages: 256,
    }));
    const blockers = convergenceTimeoutBlockers(snapshot({
      streamRequired: 4230,
      streamMaxCached: 256,
      streamSafetyCacheCapacityOk: 0,
      streamSafetyRequired: 874,
      streamSafetyReady: 256,
      streamSafetyPending: 616,
      streamParentCoverageViolations: 618,
      streamActiveRootPages: 256,
    }));

    expect(result.streamQuiet).toBe(false);
    expect(blockers[0]).toContain("safetyCacheCapacityOk=0 safetyRequired=874 maxCached=256");
  });

  it("treats parent-covered refinement work as quiet", () => {
    expect(evaluateConvergence(snapshot({
      streamCached: 17,
      streamReady: 17,
      streamPending: 8,
      streamInflight: 1,
      streamSafetyRequired: 4,
      streamSafetyReady: 4,
      streamSafetyPending: 0,
      streamSafetyInflight: 0,
      streamRefinementPending: 8,
      streamRefinementInflight: 8,
      streamParentCoverageViolations: 0,
      streamActiveRootPages: 17,
    })).streamQuiet).toBe(true);
  });

  it("does not treat missing parent coverage as quiet", () => {
    const result = evaluateConvergence(snapshot({
      streamSafetyRequired: 4,
      streamSafetyReady: 3,
      streamSafetyPending: 1,
      streamSafetyInflight: 0,
      streamRefinementPending: 0,
      streamRefinementInflight: 0,
      streamParentCoverageViolations: 1,
      streamActiveRootPages: 3,
    }));

    expect(result.streamQuiet).toBe(false);
  });

  it("waits for the proven streaming frontier and readiness epoch", () => {
    expect(evaluateConvergence(snapshot({ streamReadyFrame: -1 })).quiet).toBe(false);
    expect(evaluateConvergence(snapshot({
      farClipmapInnerRadiusM: 768,
      streamReadyFrontierM: 383,
    })).quiet).toBe(false);
    expect(evaluateConvergence(snapshot({
      farClipmapInnerRadiusM: 768,
      streamReadyFrontierM: 384,
    })).quiet).toBe(true);
  });

  it("waits for heightfield work and fallback sampling to drain", () => {
    expect(evaluateConvergence(snapshot({ heightfieldPending: 1 })).quiet).toBe(false);
    expect(evaluateConvergence(snapshot({ heightfieldInflight: 1 })).quiet).toBe(false);
    expect(evaluateConvergence(snapshot({ heightfieldFallbackSamples: 1 })).quiet).toBe(false);
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

  it("passes bounded acceptance warmup budgets by profile", () => {
    expect(profileAcceptanceParams("reuse")).toMatchObject({
      liveBubbleBudget: "4",
      liveBubbleGpuChunkBudget: "16",
      liveBubbleMaxInflightChunks: "128",
      liveClodRootBudget: "16",
      liveClodRootApplyBudget: "4",
      liveClodRootMaxInflightBatches: "1",
      liveClodRootMaxCached: "512",
      liveClodRootMaxLevel: "1",
      liveClodRootRadius: "384",
      farClipmapInnerRadius: "384",
      farClipmapOuterRadius: "4096",
      farSummaryMaxTileBuildsPerFrame: "4",
      farSummaryMaxBuildMsPerFrame: "6",
    });
    expect(profileAcceptanceParams("fast")).toMatchObject({
      liveBubbleBudget: "8",
      liveBubbleGpuChunkBudget: "16",
      liveBubbleMaxInflightChunks: "128",
      liveClodRootBudget: "16",
      liveClodRootApplyBudget: "4",
      liveClodRootMaxInflightBatches: "1",
      liveClodRootMaxCached: "512",
      liveClodRootMaxLevel: "1",
      liveClodRootRadius: "384",
      liveClodRootGpuMesher: "1",
      liveClodRootGpuBatchSize: "4",
      liveClodRootGpuMaxInflightBatches: "2",
      liveClodRootGpuFallback: "1",
      farClipmapInnerRadius: "384",
      farClipmapOuterRadius: "4096",
      farSummaryMaxTileBuildsPerFrame: "8",
      farSummaryMaxBuildMsPerFrame: "8",
    });
    expect(profileAcceptanceParams("reuse")).not.toHaveProperty("farClipmap");
    expect(profileAcceptanceParams("reuse")).not.toHaveProperty("farClipmapMode");
    expect(profileAcceptanceParams("fast")).not.toHaveProperty("farClipmap");
    expect(profileAcceptanceParams("fast")).not.toHaveProperty("farClipmapMode");
  });

  it("gives reuse a positive streamed CLOD budget and cache cap", () => {
    const params = profileAcceptanceParams("reuse");

    expect(Number(params["liveClodRootBudget"])).toBeGreaterThan(0);
    expect(Number(params["liveClodRootApplyBudget"])).toBeGreaterThan(0);
    expect(Number(params["liveClodRootMaxInflightBatches"])).toBeGreaterThan(0);
    expect(Number(params["liveClodRootMaxCached"])).toBeGreaterThan(0);
    expect(Number(params["liveClodRootMaxLevel"])).toBeGreaterThan(0);
    expect(Number(params["liveClodRootRadius"])).toBeGreaterThan(0);
  });
});
