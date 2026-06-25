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
  maxTileBuildsPerFrame: number;
  maxTileCommitsPerFrame: number;
  evictionGraceSeconds: number;
  keepStaleUntilReplacement: boolean;
}

export interface FarSummarySamplingConfig {
  fallbackToProcedural: boolean;
  fallbackToLowerRing: boolean;
  conservativeMissingHeightM: number;
  normalSampleStepCells: number;
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
    maxTileBuildsPerFrame: 4,
    maxTileCommitsPerFrame: 8,
    evictionGraceSeconds: 12.0,
    keepStaleUntilReplacement: true,
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
