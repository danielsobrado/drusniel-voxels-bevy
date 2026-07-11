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
  // Infinite-islands streams hundreds of root pages on boot/teleport; the serial CPU
  // worker builds ~3 pages/s while the GPU mesher measures ~16 pages/s (5x) with the
  // guarded CPU fallback still in place, so the GPU path is the scene default there.
  // liveClodRootGpuMesher=0 opts back into the CPU worker.
  const defaultEnabled = defaults.enabled || params.get("scene") === "infinite-islands";
  return {
    enabled: booleanFlag(params, "liveClodRootGpuMesher", defaultEnabled),
    batchSize: positiveIntegerParam(params, "liveClodRootGpuBatchSize") ?? defaults.batchSize,
    maxInflightBatches: positiveIntegerParam(params, "liveClodRootGpuMaxInflightBatches") ?? defaults.maxInflightBatches,
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
