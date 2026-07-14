export interface GpuClodHierarchyConfig {
  enabled: boolean;
  residentMaxLevel: number;
  maxResidentBytes: number;
  meshlets: boolean;
  meshletMaxVertices: number;
  meshletMaxTriangles: number;
  gpuWeld: boolean;
  gpuSimplify: boolean;
}

const DEFAULT_MAX_RESIDENT_BYTES = 256 * 1024 * 1024;
const DEFAULT_MESHLET_MAX_VERTICES = 64;
const DEFAULT_MESHLET_MAX_TRIANGLES = 64;

export const DEFAULT_GPU_CLOD_HIERARCHY_CONFIG: GpuClodHierarchyConfig = {
  enabled: false,
  residentMaxLevel: 0,
  maxResidentBytes: DEFAULT_MAX_RESIDENT_BYTES,
  meshlets: true,
  meshletMaxVertices: DEFAULT_MESHLET_MAX_VERTICES,
  meshletMaxTriangles: DEFAULT_MESHLET_MAX_TRIANGLES,
  gpuWeld: false,
  gpuSimplify: false,
};

function booleanFlag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

function nonNegativeInteger(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function positiveInteger(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseGpuClodHierarchyConfig(
  params: URLSearchParams,
  defaults: GpuClodHierarchyConfig = DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
): GpuClodHierarchyConfig {
  return {
    enabled: booleanFlag(params, "liveClodGpuHierarchy", defaults.enabled),
    residentMaxLevel: nonNegativeInteger(params, "liveClodGpuResidentMaxLevel", defaults.residentMaxLevel),
    maxResidentBytes: positiveInteger(params, "liveClodGpuResidentBytes", defaults.maxResidentBytes),
    meshlets: booleanFlag(params, "liveClodGpuMeshlets", defaults.meshlets),
    meshletMaxVertices: positiveInteger(params, "liveClodGpuMeshletVertices", defaults.meshletMaxVertices),
    meshletMaxTriangles: positiveInteger(params, "liveClodGpuMeshletTriangles", defaults.meshletMaxTriangles),
    gpuWeld: booleanFlag(params, "liveClodGpuWeld", defaults.gpuWeld),
    gpuSimplify: booleanFlag(params, "liveClodGpuSimplify", defaults.gpuSimplify),
  };
}

export function gpuClodHierarchyConfigFromWindow(): GpuClodHierarchyConfig {
  const search = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } })
    .window?.location?.search ?? "";
  return parseGpuClodHierarchyConfig(new URLSearchParams(search));
}
