export type AcceptanceProfile = "full" | "fast" | "reuse";

export interface ConvergenceSnapshot {
  tilesMissing: number;
  tilesBuilding: number;
  farShellRebuildPending: number;
  textureWindowPending: number;
  bubbleBuilding: number;
  bubbleReady: number;
  bubbleRequired: number;
  bubbleFailed: number;
  bubbleRetryPages: number;
  bubblePendingChunks: number;
  bubbleInflightChunks: number;
  streamRequired: number;
  streamBudget: number;
  streamPending: number;
  streamInflight: number;
  streamReady: number;
  streamCached: number;
  streamFailed: number;
  streamMaxCached: number;
  streamSafetyCacheCapacityOk: number;
  streamSafetyRequired: number;
  streamSafetyReady: number;
  streamSafetyPending: number;
  streamSafetyInflight: number;
  streamRefinementPending: number;
  streamRefinementInflight: number;
  streamParentCoverageViolations: number;
  streamActiveRootPages: number;
  proxyBuilding: number;
}

export interface AcceptanceSceneCacheEvidence {
  clodCacheHit: number;
  clodCacheMiss: number;
  clodCacheRehydrateMs: number;
  clodCacheKeyMatch: number;
  terrainSummaryCacheHit: number;
  terrainSummaryCacheMiss: number;
  startupBuildWorldMs: number;
  startupTerrainSummaryMs: number;
  startupTotalMs: number;
  reuseEnabled: number;
  reuseMode: number;
  page_reused: number;
  startup_reexecuted: number;
}

const STREAMED_ROOT_GPU_PARAMS = {
  liveClodRootGpuMesher: "1",
  liveClodRootGpuBatchSize: "4",
  liveClodRootGpuMaxInflightBatches: "2",
  liveClodRootGpuFallback: "1",
} as const;

const ACCEPTANCE_RENDER_PARAMS = {
  renderScale: "0.5",
  render_scale: "0.5",
  dprCap: "1",
  dpr_cap: "1",
} as const;

const ACCEPTANCE_PERF_PROBE_PARAMS = {
  perfProbe: "1",
  perfProbeConvergenceGate: "0",
  perfWarmupFrames: "0",
} as const;

export function profileAcceptanceParams(profile: AcceptanceProfile): Record<string, string> {
  if (profile === "fast") {
    return {
      ...ACCEPTANCE_RENDER_PARAMS,
      ...ACCEPTANCE_PERF_PROBE_PARAMS,
      perfSampleFrames: "60",
      liveBubbleBudget: "8",
      liveBubbleGpuChunkBudget: "16",
      liveBubbleMaxInflightChunks: "128",
      liveBubbleColliderRadius: "128",
      liveClodRootBudget: "16",
      liveClodRootApplyBudget: "4",
      liveClodRootMaxInflightBatches: "1",
      liveClodRootMaxCached: "512",
      liveClodRootMaxLevel: "1",
      liveClodRootRadius: "384",
      ...STREAMED_ROOT_GPU_PARAMS,
      farClipmap: "1",
      farClipmapInnerRadius: "384",
      farClipmapOuterRadius: "4096",
      farSummaryMaxTileBuildsPerFrame: "8",
      farSummaryMaxBuildMsPerFrame: "8",
    };
  }
  return {
    ...ACCEPTANCE_RENDER_PARAMS,
    ...ACCEPTANCE_PERF_PROBE_PARAMS,
    perfSampleFrames: "180",
    liveBubbleBudget: "4",
    liveBubbleGpuChunkBudget: "16",
    liveBubbleMaxInflightChunks: "128",
    liveBubbleColliderRadius: "128",
    liveClodRootBudget: "16",
    liveClodRootApplyBudget: "4",
    liveClodRootMaxInflightBatches: "1",
    liveClodRootMaxCached: "512",
    liveClodRootMaxLevel: "1",
    liveClodRootRadius: "384",
    ...STREAMED_ROOT_GPU_PARAMS,
    farClipmap: "1",
    farClipmapInnerRadius: "384",
    farClipmapOuterRadius: "4096",
    farSummaryMaxTileBuildsPerFrame: "4",
    farSummaryMaxBuildMsPerFrame: "6",
  };
}

export function evaluateConvergence(snapshot: ConvergenceSnapshot): {
  quiet: boolean;
  farSummaryQuiet: boolean;
  bubbleQuiet: boolean;
  streamQuiet: boolean;
} {
  const farSummaryQuiet = snapshot.tilesMissing === 0 && snapshot.tilesBuilding === 0;
  const shellQuiet = snapshot.farShellRebuildPending === 0;
  const textureQuiet = snapshot.textureWindowPending === 0;
  const bubbleQuiet = snapshot.bubbleRequired === 0 || (
    snapshot.bubbleFailed === 0
    && snapshot.bubbleRetryPages === 0
    && snapshot.bubbleBuilding === 0
    && snapshot.bubblePendingChunks === 0
    && snapshot.bubbleInflightChunks === 0
    && snapshot.bubbleReady > 0
  );
  const streamQuiet = snapshot.streamRequired === 0 || (
    snapshot.streamFailed === 0
    && snapshot.streamSafetyCacheCapacityOk !== 0
    && snapshot.streamSafetyPending === 0
    && snapshot.streamSafetyInflight === 0
    && snapshot.streamParentCoverageViolations === 0
    && snapshot.streamActiveRootPages > 0
  );
  return {
    quiet: farSummaryQuiet && shellQuiet && textureQuiet && bubbleQuiet && streamQuiet && snapshot.proxyBuilding !== 1,
    farSummaryQuiet,
    bubbleQuiet,
    streamQuiet,
  };
}

export function convergenceTimeoutBlockers(snapshot: ConvergenceSnapshot): string[] {
  const blockers: Array<{ rank: number; text: string }> = [];
  const evaluated = evaluateConvergence(snapshot);
  if (!evaluated.bubbleQuiet) {
    blockers.push({
      rank: snapshot.bubbleBuilding + snapshot.bubblePendingChunks + snapshot.bubbleInflightChunks,
      text:
        `liveBubble: building=${snapshot.bubbleBuilding} required=${snapshot.bubbleRequired} ` +
        `ready=${snapshot.bubbleReady} pendingChunks=${snapshot.bubblePendingChunks} ` +
        `inflightChunks=${snapshot.bubbleInflightChunks}`,
    });
  }
  if (!evaluated.farSummaryQuiet) {
    blockers.push({
      rank: snapshot.tilesMissing + snapshot.tilesBuilding,
      text: `farSummary: building=${snapshot.tilesBuilding} missing=${snapshot.tilesMissing}`,
    });
  }
  if (!evaluated.streamQuiet) {
    const streamBudgetBlocked = snapshot.streamRequired > 0 && snapshot.streamBudget === 0;
    const streamCapacityBlocked = snapshot.streamRequired > 0 && snapshot.streamSafetyCacheCapacityOk === 0;
    blockers.push({
      rank: streamBudgetBlocked || streamCapacityBlocked ? Number.POSITIVE_INFINITY : snapshot.streamPending + snapshot.streamInflight,
      text:
        `clodStream: budget=${snapshot.streamBudget} pending=${snapshot.streamPending} inflight=${snapshot.streamInflight} ` +
        `safetyCacheCapacityOk=${snapshot.streamSafetyCacheCapacityOk} safetyRequired=${snapshot.streamSafetyRequired} maxCached=${snapshot.streamMaxCached} ` +
        `safetyPending=${snapshot.streamSafetyPending} safetyInflight=${snapshot.streamSafetyInflight} ` +
        `refinementPending=${snapshot.streamRefinementPending} refinementInflight=${snapshot.streamRefinementInflight} ` +
        `parentCoverageViolations=${snapshot.streamParentCoverageViolations} activeRoots=${snapshot.streamActiveRootPages} ` +
        `cached=${snapshot.streamCached} failed=${snapshot.streamFailed}`,
    });
  }
  if (snapshot.farShellRebuildPending !== 0) blockers.push({ rank: 1, text: `farShell: rebuildPending=${snapshot.farShellRebuildPending}` });
  if (snapshot.textureWindowPending !== 0) blockers.push({ rank: 1, text: `textureWindow: pending=${snapshot.textureWindowPending}` });
  if (snapshot.proxyBuilding === 1) blockers.push({ rank: 1, text: "shadowProxy: building=1" });
  return blockers
    .sort((a, b) => b.rank - a.rank || a.text.localeCompare(b.text))
    .map((entry, index) => `${index + 1}. ${entry.text}`);
}

function numTiming(timings: Readonly<Record<string, number>>, key: string): number {
  const value = timings[key];
  return Number.isFinite(value) ? value : 0;
}

export function cacheEvidenceFromTimings(
  timings: Readonly<Record<string, number>>,
  reusedScene = false,
): AcceptanceSceneCacheEvidence {
  if (reusedScene) {
    return {
      clodCacheHit: 0,
      clodCacheMiss: 0,
      clodCacheRehydrateMs: 0,
      clodCacheKeyMatch: 0,
      terrainSummaryCacheHit: 0,
      terrainSummaryCacheMiss: 0,
      startupBuildWorldMs: 0,
      startupTerrainSummaryMs: 0,
      startupTotalMs: 0,
      reuseEnabled: 1,
      reuseMode: numTiming(timings, "acceptance_world_reuse_mode"),
      page_reused: 1,
      startup_reexecuted: 0,
    };
  }
  return {
    clodCacheHit: numTiming(timings, "clod_cache_hit"),
    clodCacheMiss: numTiming(timings, "clod_cache_miss"),
    clodCacheRehydrateMs: numTiming(timings, "clod_cache_rehydrate_ms"),
    clodCacheKeyMatch: numTiming(timings, "clod_cache_key_match"),
    terrainSummaryCacheHit: numTiming(timings, "terrain_summary_cache_hit"),
    terrainSummaryCacheMiss: numTiming(timings, "terrain_summary_cache_miss"),
    startupBuildWorldMs: numTiming(timings, "startup.build_world_ms"),
    startupTerrainSummaryMs: numTiming(timings, "startup.terrain_summary_ms"),
    startupTotalMs: numTiming(timings, "startup.total_ms"),
    reuseEnabled: numTiming(timings, "acceptance_world_reuse_enabled"),
    reuseMode: numTiming(timings, "acceptance_world_reuse_mode"),
    page_reused: 0,
    startup_reexecuted: 1,
  };
}
