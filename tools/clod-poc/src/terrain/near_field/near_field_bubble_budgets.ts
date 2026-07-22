const INFINITE_ISLANDS_SCENE = "infinite-islands";
const INFINITE_ISLANDS_DEFAULT_BUILD_BUDGET = 1;

/** Per-frame budget for resumable CPU-fallback chunk meshing. */
export const CPU_CHUNK_MESH_BUDGET_MS = 6;
export const DEFAULT_GPU_CHUNK_DISPATCH_BUDGET = 2;
export const DEFAULT_GPU_MAX_INFLIGHT_CHUNKS = Number.MAX_SAFE_INTEGER;
export const GPU_PAGE_RETRY_LIMIT = 3;
export const GPU_PAGE_RETRY_DELAY_FRAMES = 12;
/** Per-frame budget for turning completed GPU chunk meshes into scene objects + colliders. */
export const GPU_APPLY_BUDGET_MS = 2;

function positiveIntegerParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function positiveNumberParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveLiveBubbleBuildBudget(defaultBudget: number, params: URLSearchParams): number {
  const queryBudget = positiveIntegerParam(params, "liveBubbleBudget")
    ?? positiveIntegerParam(params, "live_bubble_budget");
  if (queryBudget !== null) return Math.max(1, queryBudget);

  if (params.get("scene") === INFINITE_ISLANDS_SCENE) return INFINITE_ISLANDS_DEFAULT_BUILD_BUDGET;

  const fallback = Number.isFinite(defaultBudget) && defaultBudget > 0 ? Math.floor(defaultBudget) : 1;
  return Math.max(1, fallback);
}

export function resolveLiveBubbleGpuChunkBudget(defaultBudget: number, params: URLSearchParams): number {
  const queryBudget = positiveIntegerParam(params, "liveBubbleGpuChunkBudget")
    ?? positiveIntegerParam(params, "live_bubble_gpu_chunk_budget");
  if (queryBudget !== null) return Math.max(1, queryBudget);
  const fallback = Number.isFinite(defaultBudget) && defaultBudget > 0
    ? Math.floor(defaultBudget)
    : DEFAULT_GPU_CHUNK_DISPATCH_BUDGET;
  return Math.max(1, fallback);
}

export function resolveLiveBubbleMaxInflightChunks(defaultMax: number, params: URLSearchParams): number {
  const queryMax = positiveIntegerParam(params, "liveBubbleMaxInflightChunks")
    ?? positiveIntegerParam(params, "live_bubble_max_inflight_chunks");
  if (queryMax !== null) return Math.max(1, queryMax);
  const fallback = Number.isFinite(defaultMax) && defaultMax > 0
    ? Math.floor(defaultMax)
    : DEFAULT_GPU_MAX_INFLIGHT_CHUNKS;
  return Math.max(1, fallback);
}

export function resolveLiveBubbleColliderRadius(params: URLSearchParams): number | null {
  return positiveNumberParam(params, "liveBubbleColliderRadius")
    ?? positiveNumberParam(params, "live_bubble_collider_radius");
}

export function liveBubbleBuildBudget(defaultBudget: number): number {
  if (typeof window === "undefined") return resolveLiveBubbleBuildBudget(defaultBudget, new URLSearchParams());
  return resolveLiveBubbleBuildBudget(defaultBudget, new URLSearchParams(window.location.search));
}

export function liveBubbleGpuChunkBudget(): number {
  if (typeof window === "undefined") {
    return resolveLiveBubbleGpuChunkBudget(DEFAULT_GPU_CHUNK_DISPATCH_BUDGET, new URLSearchParams());
  }
  return resolveLiveBubbleGpuChunkBudget(
    DEFAULT_GPU_CHUNK_DISPATCH_BUDGET,
    new URLSearchParams(window.location.search),
  );
}

export function liveBubbleMaxInflightChunks(): number {
  if (typeof window === "undefined") {
    return resolveLiveBubbleMaxInflightChunks(DEFAULT_GPU_MAX_INFLIGHT_CHUNKS, new URLSearchParams());
  }
  return resolveLiveBubbleMaxInflightChunks(
    DEFAULT_GPU_MAX_INFLIGHT_CHUNKS,
    new URLSearchParams(window.location.search),
  );
}

export function liveBubbleColliderRadiusOverride(): number | null {
  if (typeof window === "undefined") return null;
  return resolveLiveBubbleColliderRadius(new URLSearchParams(window.location.search));
}
