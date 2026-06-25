export type AcceptanceStatus = "pass" | "warn" | "fail";

export interface AcceptanceRunReport {
  schemaVersion: number;
  runId: string;
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  gitCommit?: string;
  configPath: string;
  status: AcceptanceStatus;
  gates: AcceptanceGateResult[];
  metrics: AcceptanceMetrics;
  artifacts: AcceptanceArtifacts;
}

export interface AcceptanceGateResult {
  id: "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  name: string;
  status: AcceptanceStatus;
  message: string;
  measurements: Record<string, number | string | boolean>;
  failures: AcceptanceFailure[];
}

export interface AcceptanceFailure {
  code: string;
  message: string;
  scene?: string;
  nodeId?: string;
  pageId?: string;
  level?: number;
  edge?: "north" | "south" | "east" | "west";
  value?: number;
  threshold?: number;
}

export interface AcceptanceMetrics {
  lod0Triangles: number;
  lod3Triangles: number;
  lod3TriangleRatio: number;
  fullHierarchyBuildMs: number;
  singleNodeRebuildP50Ms: number;
  singleNodeRebuildP95Ms: number;
  lowBenefitRateLevel1: number;
  lowBenefitRateLevel2: number;
  maxBorderPositionDelta: number;
  minBorderNormalDot: number;
  maxBorderMaterialWeightDelta: number;
  densityScarScore: number;
  visualHolePixelRatio: number;
  visualLipPixelRatio: number;
}

export interface AcceptanceArtifacts {
  summaryJson: string;
  summaryMarkdown: string;
  metricsCsv: string;
  screenshots: string[];
  debugFiles: string[];
}

export interface AcceptanceThresholds {
  borderPositionEpsilon: number;
  borderNormalDotMin: number;
  borderMaterialWeightDeltaMax: number;
  lod3TriangleRatioMax: number;
  lowBenefitRateMax: number;
  fullHierarchyBuildMsMax: number;
  singleNodeRebuildMsMax: number;
  densityScarScoreMax: number;
  visualHolePixelRatioMax: number;
  visualLipPixelRatioMax: number;
}

export interface AcceptanceConfig {
  outputDir: string;
  world: {
    lod0PagesX: number;
    lod0PagesZ: number;
    smokeLod0PagesX: number;
    smokeLod0PagesZ: number;
  };
  thresholds: AcceptanceThresholds;
  visual: {
    enabled: boolean;
    screenshotWidth: number;
    screenshotHeight: number;
    cameraFovYDeg: number;
    grazingAngleDeg: number;
    crossfadeFrames: number;
  };
  stressScenes: {
    ridgeBorder: boolean;
    cliffCorner: boolean;
    caveMouthBorder: boolean;
    thinBridge: boolean;
    forcedNeighborLodDeltas: number[];
    nearFieldBubbleMask: boolean;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
  };
}

export class AcceptanceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AcceptanceError";
  }
}

export interface Logger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export function normalizeError(error: unknown): { message: string; details: Record<string, unknown>; exitCode: number } {
  if (error instanceof AcceptanceError) {
    return {
      message: error.message,
      details: { code: error.code, ...error.details },
      exitCode: 2,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      details: { name: error.name, stack: error.stack },
      exitCode: 3,
    };
  }
  return {
    message: String(error),
    details: {},
    exitCode: 3,
  };
}
