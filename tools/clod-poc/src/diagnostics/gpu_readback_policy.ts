export type GpuReadbackMode = "off" | "debug" | "profile" | "acceptance";

export type GpuReadbackKind =
  | "clod_error_map"
  | "grass_gpu_counts"
  | "prop_gpu_counts"
  | "stone_gpu_counts"
  | "tree_gpu_counts"
  | "understory_gpu_counts";

const KIND_QUERY: Record<GpuReadbackKind, string> = {
  clod_error_map: "webgpuReadback",
  grass_gpu_counts: "grassGpuCounts",
  prop_gpu_counts: "propGpuCounts",
  stone_gpu_counts: "stoneGpuCounts",
  tree_gpu_counts: "treeGpuCounts",
  understory_gpu_counts: "understoryGpuCounts",
};

export interface GpuReadbackRequest {
  kind: GpuReadbackKind;
  frame: number;
  intervalFrames: number;
  requested?: boolean;
  search?: string | URLSearchParams;
}

export function parseGpuReadbackMode(search: string | URLSearchParams | undefined = currentSearchParams()): GpuReadbackMode {
  const q = toSearchParams(search);
  const raw = q.get("gpuReadbacks");
  return raw === "debug" || raw === "profile" || raw === "acceptance" ? raw : "off";
}

export function hasExplicitGpuReadbackOverride(kind: GpuReadbackKind, search?: string | URLSearchParams): boolean {
  const q = toSearchParams(search ?? currentSearchParams());
  return q.get(KIND_QUERY[kind]) === "1" || parseGpuReadbackMode(q) === "acceptance";
}

export function allowsGpuReadbackKind(kind: GpuReadbackKind, search?: string | URLSearchParams): boolean {
  const q = toSearchParams(search ?? currentSearchParams());
  if (q.get(KIND_QUERY[kind]) === "1") return true;
  const mode = parseGpuReadbackMode(q);
  if (mode === "acceptance") return true;
  if (kind === "clod_error_map") return mode === "debug";
  if (kind.endsWith("_gpu_counts")) return mode === "debug";
  return false;
}

export function shouldRequestGpuReadback(request: GpuReadbackRequest): boolean {
  const search = request.search ?? currentSearchParams();
  if (request.requested === false && !hasExplicitGpuReadbackOverride(request.kind, search)) return false;
  if (!allowsGpuReadbackKind(request.kind, search)) return false;
  const interval = Math.max(1, Math.floor(request.intervalFrames));
  return Math.max(0, Math.floor(request.frame)) % interval === 0;
}

function toSearchParams(search: string | URLSearchParams | undefined): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(search ?? "");
}

function currentSearchParams(): URLSearchParams {
  const maybeWindow = globalThis as typeof globalThis & { window?: { location?: { search?: string } } };
  return new URLSearchParams(maybeWindow.window?.location?.search ?? "");
}
