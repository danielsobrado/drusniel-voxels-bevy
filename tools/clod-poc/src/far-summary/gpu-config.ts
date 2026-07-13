export interface FarSummaryGpuConfig {
  enabled: boolean;
  strictParity: boolean;
  debugReadback: boolean;
  commitToCache: boolean;
  authoritative: boolean;
  sampleGrid: number;
  maxTilesPerBatch: number;
  maxBatchesPerFrame: number;
  maxBufferBytes: number;
  debugReadbackTiles: number;
}

export const FAR_SUMMARY_GPU_DESCRIPTOR_BYTES = 64;
export const FAR_SUMMARY_GPU_RECORD_BYTES = 128;
export const FAR_SUMMARY_GPU_DESCRIPTOR_FLAG_CELL_RECORDS = 1 << 0;

export const DEFAULT_FAR_SUMMARY_GPU_CONFIG: FarSummaryGpuConfig = {
  enabled: false,
  strictParity: false,
  debugReadback: false,
  commitToCache: false,
  authoritative: false,
  sampleGrid: 16,
  maxTilesPerBatch: 256,
  maxBatchesPerFrame: 1,
  maxBufferBytes: 16 * 1024 * 1024,
  debugReadbackTiles: 8,
};

export function farSummaryGpuDefaultsForScene(params: URLSearchParams): FarSummaryGpuConfig {
  if (params.get("scene") !== "continent" || params.get("farSummaryLayout") !== "2") {
    return DEFAULT_FAR_SUMMARY_GPU_CONFIG;
  }
  return {
    ...DEFAULT_FAR_SUMMARY_GPU_CONFIG,
    enabled: true,
    debugReadback: true,
    commitToCache: true,
    authoritative: true,
    maxTilesPerBatch: 8,
  };
}

export function farSummaryGpuConfigFromParams(
  params: URLSearchParams,
  defaults: FarSummaryGpuConfig = DEFAULT_FAR_SUMMARY_GPU_CONFIG,
): FarSummaryGpuConfig {
  const authoritative = booleanFlag(params, "farSummaryGpuAuthoritative", defaults.authoritative);
  const enabled = booleanFlag(params, "farSummaryGpu", defaults.enabled) || authoritative;
  const debugReadback = booleanFlag(params, "farSummaryGpuDebugReadback", defaults.debugReadback) || authoritative;
  const commitToCache = booleanFlag(params, "farSummaryGpuCommit", defaults.commitToCache) || authoritative;
  return {
    enabled,
    strictParity: booleanFlag(params, "farSummaryGpuStrictParity", defaults.strictParity),
    debugReadback,
    commitToCache,
    authoritative,
    sampleGrid: positiveInteger(params, "farSummaryGpuSampleGrid", defaults.sampleGrid),
    maxTilesPerBatch: positiveInteger(params, "farSummaryGpuMaxTilesPerBatch", defaults.maxTilesPerBatch),
    maxBatchesPerFrame: positiveInteger(params, "farSummaryGpuMaxBatchesPerFrame", defaults.maxBatchesPerFrame),
    maxBufferBytes: positiveInteger(params, "farSummaryGpuMaxBufferBytes", defaults.maxBufferBytes),
    debugReadbackTiles: nonNegativeInteger(params, "farSummaryGpuDebugReadbackTiles", defaults.debugReadbackTiles),
  };
}

export function farSummaryGpuConfigFromWindow(): FarSummaryGpuConfig {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  return farSummaryGpuConfigFromParams(new URLSearchParams(maybeWindow?.location?.search ?? ""));
}

export type FarSummaryGpuFallbackReason =
  | "disabled"
  | "webgpu_unavailable"
  | "no_dirty_tiles"
  | "ready";

export interface FarSummaryGpuFallbackDecision {
  useGpu: boolean;
  reason: FarSummaryGpuFallbackReason;
}

export function farSummaryGpuFallbackDecision(
  config: FarSummaryGpuConfig,
  webGpuAvailable: boolean,
  dirtyTiles: number,
): FarSummaryGpuFallbackDecision {
  if (!config.enabled) return { useGpu: false, reason: "disabled" };
  if (!webGpuAvailable) return { useGpu: false, reason: "webgpu_unavailable" };
  if (dirtyTiles <= 0) return { useGpu: false, reason: "no_dirty_tiles" };
  return { useGpu: true, reason: "ready" };
}

function booleanFlag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

function positiveInteger(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
