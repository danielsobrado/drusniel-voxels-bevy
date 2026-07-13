export interface StreamingRootGpuMesherConfig {
  enabled: boolean;
  batchSize: number;
  maxInflightBatches: number;
  fallback: boolean;
  maxChunkSlots?: number;
  maxTotalSlotBytes?: number;
  maxReadbackBufferBytes?: number;
}

export const DEFAULT_STREAMING_ROOT_GPU_BATCH_SIZE = 4;
export const DEFAULT_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES = 1;
export const DEFAULT_INFINITE_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES = 2;

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

export function continentTileMeshingEnabled(params: URLSearchParams): boolean {
  return params.get("scene") === "continent" && booleanFlag(params, "gpuTileMesh", true);
}

export function parseStreamingRootGpuMesherConfig(
  params: URLSearchParams,
  defaults: StreamingRootGpuMesherConfig = DEFAULT_STREAMING_ROOT_GPU_MESHER_CONFIG,
): StreamingRootGpuMesherConfig {
  // Infinite-islands streams hundreds of root pages on boot/teleport. The guarded GPU path is
  // the scene default, and two independent buffer pools overlap compute/readback with CPU page
  // assembly without increasing the configured aggregate slot/readback memory budgets.
  const scene = params.get("scene");
  const gpuTileMesh = continentTileMeshingEnabled(params);
  const infiniteIslands = scene === "infinite-islands";
  const defaultEnabled = defaults.enabled || infiniteIslands || gpuTileMesh;
  const defaultInflight = infiniteIslands
    ? Math.max(defaults.maxInflightBatches, DEFAULT_INFINITE_STREAMING_ROOT_GPU_MAX_INFLIGHT_BATCHES)
    : defaults.maxInflightBatches;
  return {
    enabled: booleanFlag(params, "liveClodRootGpuMesher", defaultEnabled),
    batchSize: positiveIntegerParam(params, "liveClodRootGpuBatchSize") ?? (gpuTileMesh ? 1 : defaults.batchSize),
    maxInflightBatches: positiveIntegerParam(params, "liveClodRootGpuMaxInflightBatches") ?? defaultInflight,
    fallback: booleanFlag(params, "liveClodRootGpuFallback", defaults.fallback),
    maxChunkSlots: positiveIntegerParam(params, "liveClodRootGpuMaxChunkSlots") ?? defaults.maxChunkSlots,
    maxTotalSlotBytes: positiveIntegerParam(params, "liveClodRootGpuMaxSlotBytes") ?? defaults.maxTotalSlotBytes,
    maxReadbackBufferBytes: positiveIntegerParam(params, "liveClodRootGpuMaxReadbackBytes") ?? defaults.maxReadbackBufferBytes,
  };
}

export function streamingRootGpuMesherConfigFromWindow(): StreamingRootGpuMesherConfig {
  const maybeWindow = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window;
  return parseStreamingRootGpuMesherConfig(new URLSearchParams(maybeWindow?.location?.search ?? ""));
}
