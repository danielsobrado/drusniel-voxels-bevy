export interface StreamingRootGpuMesherConfig {
  enabled: boolean;
  batchSize: number;
  maxInflightBatches: number;
  fallback: boolean;
}

export const DEFAULT_STREAMING_ROOT_GPU_BATCH_SIZE = 4;
export const DEFAULT_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES = 1;

export const DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG: StreamingRootGpuMesherConfig = {
  enabled: false,
  batchSize: DEFAULT_STREAMING_ROOT_GPU_BATCH_SIZE,
  maxInflightBatches: DEFAULT_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES,
  fallback: true,
};

function positiveIntegerParam(params: URLSearchParams, key: string): number | undefined {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function booleanFlag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

export function parseStreamingRootGpuMesherConfig(
  params: URLSearchParams,
  defaults: StreamingRootGpuMesherConfig = DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG,
): StreamingRootGpuMesherConfig {
  return {
    enabled: booleanFlag(params, "liveClodRootGpuMesher", defaults.enabled),
    batchSize: positiveIntegerParam(params, "liveClodRootGpuBatchSize") ?? defaults.batchSize,
    maxInflightBatches: positiveIntegerParam(params, "liveClodRootGpuMaxInflightBatches") ?? defaults.maxInflightBatches,
    fallback: booleanFlag(params, "liveClodRootGpuFallback", defaults.fallback),
  };
}

export function streamingRootGpuMesherConfigFromWindow(): StreamingRootGpuMesherConfig {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  return parseStreamingRootGpuMesherConfig(new URLSearchParams(maybeWindow?.location?.search ?? ""));
}
