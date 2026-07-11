// TODO: Load from YAML (config/far_summary.yaml) once the YAML file is created.
// For now, the config is a TypeScript object with a clear migration path.

export interface FarSummaryRingConfig {
  name: string;
  startM: number;
  endM: number;
  cellM: number;
  tileCells: number;
}

export interface FarSummaryStreamConfig {
  preloadSeconds: number;
  ringCoverageMarginM: number;
  maxTileBuildsPerFrame: number;
  maxTileCommitsPerFrame: number;
  maxBuildMsPerFrame: number;
  evictionGraceSeconds: number;
  keepStaleUntilReplacement: boolean;
  /** While ready coverage of the required tile set sits below this ratio, the warmup
   *  budgets below apply so a cold boot converges in seconds instead of minutes (the
   *  steady-state 2 ms slice needs many frames per tile — the "two flat areas" symptom). */
  warmupReadyRatio: number;
  warmupMaxTileBuildsPerFrame: number;
  warmupMaxBuildMsPerFrame: number;
}

export interface FarSummarySamplingConfig {
  fallbackToProcedural: boolean;
  fallbackToLowerRing: boolean;
  conservativeMissingHeightM: number;
  normalSampleStepCells: number;
  /** When true, missing tiles produce a warning in the stats instead of
   *  silently falling back to procedural terrain.  Use during validation
   *  scenes to confirm the summary cache is the real source. */
  disableProceduralFallback?: boolean;
}

export interface FarSummaryDebugConfig {
  showClipmapGrid: boolean;
  showTileStates: boolean;
  showSummaryNormals: boolean;
  showRingColors: boolean;
}

export interface FarSummaryConfig {
  enabled: boolean;
  targetVisibleM: number;
  stream: FarSummaryStreamConfig;
  rings: FarSummaryRingConfig[];
  sampling: FarSummarySamplingConfig;
  debug: FarSummaryDebugConfig;
}

export const DEFAULT_FAR_SUMMARY_CONFIG: FarSummaryConfig = {
  enabled: true,
  targetVisibleM: 4096,

  stream: {
    preloadSeconds: 4.0,
    ringCoverageMarginM: 256,
    maxTileBuildsPerFrame: 1,
    maxTileCommitsPerFrame: 8,
    maxBuildMsPerFrame: 2.0,
    evictionGraceSeconds: 12.0,
    keepStaleUntilReplacement: true,
    warmupReadyRatio: 0.95,
    warmupMaxTileBuildsPerFrame: 4,
    warmupMaxBuildMsPerFrame: 12.0,
  },

  rings: [
    {
      name: "near_far",
      startM: 1536,
      endM: 4096,
      cellM: 32,
      tileCells: 32,
    },
    {
      name: "mid_far",
      startM: 4096,
      endM: 8192,
      cellM: 64,
      tileCells: 32,
    },
    {
      name: "horizon",
      startM: 8192,
      endM: 16384,
      cellM: 128,
      tileCells: 32,
    },
  ],

  sampling: {
    fallbackToProcedural: true,
    fallbackToLowerRing: true,
    conservativeMissingHeightM: 0,
    normalSampleStepCells: 1,
  },

  debug: {
    showClipmapGrid: false,
    showTileStates: false,
    showSummaryNormals: false,
    showRingColors: false,
  },
};

export interface FarSummaryBuildBudgets {
  /** Max whole-tile completions this frame (undefined = use config steady-state). */
  maxBuilds: number | undefined;
  /** Time-slice for incremental build stepping this frame, in ms. */
  budgetMs: number;
  warming: boolean;
}

/**
 * Build budgets for this frame. Cold coverage (readyRatio below warmupReadyRatio) gets
 * the boosted warmup budgets; converged scenes drop back to the cheap steady-state
 * slice. `forceSlowBuilds` (debug hook) always wins with the minimal budget.
 */
export function resolveFarSummaryBuildBudgets(
  stream: FarSummaryStreamConfig,
  readyRatio: number,
  forceSlowBuilds: boolean,
): FarSummaryBuildBudgets {
  if (forceSlowBuilds) {
    return { maxBuilds: 1, budgetMs: Math.max(0, stream.maxBuildMsPerFrame), warming: false };
  }
  const warming = readyRatio < stream.warmupReadyRatio;
  if (!warming) {
    return { maxBuilds: undefined, budgetMs: Math.max(0, stream.maxBuildMsPerFrame), warming };
  }
  return {
    maxBuilds: Math.max(stream.maxTileBuildsPerFrame, stream.warmupMaxTileBuildsPerFrame),
    budgetMs: Math.max(stream.maxBuildMsPerFrame, stream.warmupMaxBuildMsPerFrame),
    warming,
  };
}

export function farSummaryRingForDistance(
  distanceM: number,
  config: FarSummaryConfig,
): FarSummaryRingConfig | null {
  for (const ring of config.rings) {
    if (distanceM >= ring.startM && distanceM < ring.endM) {
      return ring;
    }
  }
  return null;
}
