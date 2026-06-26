import { DEFAULT_FAR_SUMMARY_CONFIG, type FarSummaryConfig, type FarSummaryRingConfig, type FarSummaryStreamConfig, type FarSummarySamplingConfig, type FarSummaryDebugConfig } from "../far-summary/config.js";

export interface LongViewConfig {
  targetVisibleMeters: number;

  farSummary: {
    enabled: boolean;
    startMeters: number;
    endMeters: number;
    tileSizeMeters: number;
    rings: FarSummaryRingConfig[];
    maxTilesBuiltPerFrame: number;
    staleTileGraceSeconds: number;
  };

  farShell: {
    enabled: boolean;
    startMeters: number;
    endMeters: number;
    gridResolution: number;
    radialSegments: number;
    angularSegments: number;
    heightBiasMeters: number;
    nearBlendMeters: number;
    farFadeMeters: number;
    macroBlendStartMeters: number;
    macroBlendEndMeters: number;
    rebaseSnapMeters: number;
  };

  debug: {
    showFarSummaryTiles: boolean;
    showFarShellWireframe: boolean;
    showShellRings: boolean;
    showMissingSummaryFallback: boolean;
  };
}

function rawDefaultConfig(): LongViewConfig {
  return {
    targetVisibleMeters: 4096,
    farSummary: {
      enabled: true,
      startMeters: 1536,
      endMeters: 8192,
      tileSizeMeters: 256,
      maxTilesBuiltPerFrame: 4,
      staleTileGraceSeconds: 10,
      rings: [
        { name: "near_far", startM: 1536, endM: 4096, cellM: 32, tileCells: 32 },
        { name: "mid_far", startM: 4096, endM: 8192, cellM: 64, tileCells: 32 },
        { name: "horizon", startM: 8192, endM: 16384, cellM: 128, tileCells: 32 },
      ],
    },
    farShell: {
      enabled: true,
      startMeters: 4096, endMeters: 16384,
      gridResolution: 192, radialSegments: 96, angularSegments: 192,
      heightBiasMeters: 0.6, nearBlendMeters: 512, farFadeMeters: 2048,
      macroBlendStartMeters: 8192, macroBlendEndMeters: 16384,
      rebaseSnapMeters: 64,
    },
    debug: {
      showFarSummaryTiles: false, showFarShellWireframe: false,
      showShellRings: false, showMissingSummaryFallback: false,
    },
  };
}

function deepCloneLongViewConfig(src: LongViewConfig): LongViewConfig {
  return {
    targetVisibleMeters: src.targetVisibleMeters,
    farSummary: {
      ...src.farSummary,
      rings: src.farSummary.rings.map(r => ({ ...r })),
    },
    farShell: { ...src.farShell },
    debug: { ...src.debug },
  };
}

export function createDefaultLongViewConfig(): LongViewConfig {
  return deepCloneLongViewConfig(rawDefaultConfig());
}

export const DEFAULT_LONG_VIEW_CONFIG: LongViewConfig = rawDefaultConfig();

export function longViewConfigToFarSummaryConfig(lvConfig: LongViewConfig): FarSummaryConfig {
  const fs = lvConfig.farSummary;
  return {
    ...DEFAULT_FAR_SUMMARY_CONFIG,
    enabled: fs.enabled,
    targetVisibleM: lvConfig.targetVisibleMeters,
    stream: {
      ...DEFAULT_FAR_SUMMARY_CONFIG.stream,
      maxTileBuildsPerFrame: fs.maxTilesBuiltPerFrame,
      evictionGraceSeconds: fs.staleTileGraceSeconds,
    } satisfies FarSummaryStreamConfig,
    rings: fs.rings,
    sampling: {
      ...DEFAULT_FAR_SUMMARY_CONFIG.sampling,
    } satisfies FarSummarySamplingConfig,
    debug: {
      showClipmapGrid: lvConfig.debug.showFarSummaryTiles,
      showTileStates: lvConfig.debug.showFarSummaryTiles,
      showSummaryNormals: false,
      showRingColors: lvConfig.debug.showShellRings,
    } satisfies FarSummaryDebugConfig,
  };
}
