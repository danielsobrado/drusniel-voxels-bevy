import { parseRendererBackend } from "../../rendering/renderer_backend.js";

export type FarClipmapDebugMode = "final" | "biome" | "height" | "ownership";

export interface FarClipmapConfig {
  enabled: boolean;
  innerRadiusM: number;
  outerRadiusM: number;
  ringCount: number;
  baseCellSizeM: number;
  gridResolution: number;
  snapSizeM: number;
  heightScale: number;
  yOffset: number;
  /** World-space sea level (m). The far terrain samples absolute world heights, so its underwater
   *  colouring must use the same sea level as the ocean plane or the two disagree on the waterline. */
  seaLevelM: number;
  maxRebuildsPerFrame: number;
  materialDebugMode: FarClipmapDebugMode;
  shaderDisplacement: boolean;
  sourceRefreshMaxPerFrame: number;
  sourceRefreshIntervalFrames: number;
}

export interface FarClipmapConfigConstraints {
  liveCollisionRadiusM?: number;
  clodCoverageRadiusM?: number;
  targetVisibleRadiusM?: number;
}

export const DEFAULT_FAR_CLIPMAP_CONFIG: FarClipmapConfig = Object.freeze({
  enabled: true,
  innerRadiusM: 384,
  outerRadiusM: 4096,
  ringCount: 5,
  baseCellSizeM: 8,
  gridResolution: 129,
  snapSizeM: 128,
  heightScale: 1,
  yOffset: 0,
  seaLevelM: 18,
  maxRebuildsPerFrame: 2,
  materialDebugMode: "final",
  shaderDisplacement: true,
  sourceRefreshMaxPerFrame: 1,
  // Per-ring floor between stable-ring source refreshes (revision-driven included).
  // Far content sits 384m+ out. Five rings refreshed every 60 frames put the CPU texture
  // resample in more than 5% of frames, making it a direct p95 cost. Stable rings refresh
  // every 120 frames; snap changes still refresh immediately, so traversal never moves a
  // stale texture window and the previous GPU texture remains visible between updates.
  sourceRefreshIntervalFrames: 120,
});

const DEBUG_MODES: ReadonlySet<string> = new Set<FarClipmapDebugMode>([
  "final",
  "biome",
  "height",
  "ownership",
]);

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value, fallback);
  return Math.max(0, Math.floor(parsed));
}

function boolFromQuery(value: string | null, fallback: boolean): boolean {
  if (value === null || value.trim() === "") return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return fallback;
}

function numberFromQuery(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveQueryNumber(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = numberFromQuery(params, key, fallback);
  return parsed > 0 ? parsed : fallback;
}

function nonNegativeQueryInteger(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = numberFromQuery(params, key, fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function integerQueryNumber(params: URLSearchParams, key: string, fallback: number): number {
  return Math.floor(positiveQueryNumber(params, key, fallback));
}

function debugMode(value: unknown, fallback: FarClipmapDebugMode): FarClipmapDebugMode {
  return typeof value === "string" && DEBUG_MODES.has(value) ? value as FarClipmapDebugMode : fallback;
}

export function farClipmapRendererAllowed(
  params: URLSearchParams,
  webGpuAvailable = parseRendererBackend(params) === "webgpu",
): boolean {
  const sceneName = params.get("scene") ?? "";
  if (!sceneName.startsWith("infinite-")) return true;
  return params.get("farClipmapMode") === "replace" && webGpuAvailable;
}

export function resolveFarClipmapConfig(
  partial: Partial<FarClipmapConfig> = {},
  constraints: FarClipmapConfigConstraints = {},
): FarClipmapConfig {
  const base = DEFAULT_FAR_CLIPMAP_CONFIG;
  const config: FarClipmapConfig = {
    enabled: typeof partial.enabled === "boolean" ? partial.enabled : base.enabled,
    innerRadiusM: positiveNumber(partial.innerRadiusM, base.innerRadiusM),
    outerRadiusM: positiveNumber(partial.outerRadiusM, base.outerRadiusM),
    ringCount: positiveInteger(partial.ringCount, base.ringCount),
    baseCellSizeM: positiveNumber(partial.baseCellSizeM, base.baseCellSizeM),
    gridResolution: positiveInteger(partial.gridResolution, base.gridResolution),
    snapSizeM: positiveNumber(partial.snapSizeM, base.snapSizeM),
    heightScale: finiteNumber(partial.heightScale, base.heightScale),
    yOffset: finiteNumber(partial.yOffset, base.yOffset),
    seaLevelM: finiteNumber(partial.seaLevelM, base.seaLevelM),
    maxRebuildsPerFrame: nonNegativeInteger(partial.maxRebuildsPerFrame, base.maxRebuildsPerFrame),
    materialDebugMode: debugMode(partial.materialDebugMode, base.materialDebugMode),
    shaderDisplacement: typeof partial.shaderDisplacement === "boolean" ? partial.shaderDisplacement : base.shaderDisplacement,
    sourceRefreshMaxPerFrame: nonNegativeInteger(partial.sourceRefreshMaxPerFrame, base.sourceRefreshMaxPerFrame),
    sourceRefreshIntervalFrames: positiveInteger(partial.sourceRefreshIntervalFrames, base.sourceRefreshIntervalFrames),
  };

  const minInner = constraints.liveCollisionRadiusM === undefined
    ? config.baseCellSizeM
    : constraints.liveCollisionRadiusM + config.baseCellSizeM;
  if (config.innerRadiusM <= minInner) {
    config.innerRadiusM = Math.ceil(minInner / config.baseCellSizeM) * config.baseCellSizeM;
  }

  const minOuter = Math.max(
    config.innerRadiusM + config.baseCellSizeM,
    constraints.clodCoverageRadiusM ?? 0,
    constraints.targetVisibleRadiusM ?? 0,
  );
  if (config.outerRadiusM < minOuter) {
    config.outerRadiusM = Math.ceil(minOuter / config.snapSizeM) * config.snapSizeM;
  }

  if (config.gridResolution < 2) config.gridResolution = 2;
  return config;
}

export function farClipmapConfigFromSearchParams(
  params: URLSearchParams,
  constraints: FarClipmapConfigConstraints = {},
): FarClipmapConfig {
  const base = DEFAULT_FAR_CLIPMAP_CONFIG;
  const requestedEnabled = boolFromQuery(params.get("farClipmap"), base.enabled);
  return resolveFarClipmapConfig({
    enabled: requestedEnabled && farClipmapRendererAllowed(params),
    innerRadiusM: positiveQueryNumber(params, "farClipmapInnerRadius", base.innerRadiusM),
    outerRadiusM: positiveQueryNumber(params, "farClipmapOuterRadius", base.outerRadiusM),
    ringCount: integerQueryNumber(params, "farClipmapRingCount", base.ringCount),
    baseCellSizeM: positiveQueryNumber(params, "farClipmapBaseCellSize", base.baseCellSizeM),
    gridResolution: integerQueryNumber(params, "farClipmapGridResolution", base.gridResolution),
    snapSizeM: positiveQueryNumber(params, "farClipmapSnapSize", base.snapSizeM),
    heightScale: numberFromQuery(params, "farClipmapHeightScale", base.heightScale),
    yOffset: numberFromQuery(params, "farClipmapYOffset", base.yOffset),
    // Same sea level the world build reads (world_build_startup: seaLevel/sea_level, default 18) so the
    // far terrain's waterline agrees with the ocean plane instead of fighting it.
    seaLevelM: numberFromQuery(params, "seaLevel", numberFromQuery(params, "sea_level", base.seaLevelM)),
    maxRebuildsPerFrame: integerQueryNumber(params, "farClipmapMaxRebuildsPerFrame", base.maxRebuildsPerFrame),
    materialDebugMode: debugMode(params.get("farClipmapDebug"), base.materialDebugMode),
    shaderDisplacement: boolFromQuery(params.get("farClipmapShaderDisplacement"), base.shaderDisplacement),
    sourceRefreshMaxPerFrame: nonNegativeQueryInteger(params, "farClipmapSourceRefreshMaxPerFrame", base.sourceRefreshMaxPerFrame),
    sourceRefreshIntervalFrames: integerQueryNumber(params, "farClipmapSourceRefreshIntervalFrames", base.sourceRefreshIntervalFrames),
  }, constraints);
}
