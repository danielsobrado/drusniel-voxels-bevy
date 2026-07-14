export interface GpuClodHierarchyConfig {
  enabled: boolean;
  renderResidentPages: boolean;
  readbackMinLevel: number;
  residentMaxLevel: number;
  maxResidentBytes: number;
  meshlets: boolean;
  meshletMaxVertices: number;
  meshletMaxTriangles: number;
  gpuWeld: boolean;
  gpuSimplify: boolean;
  simplifyClusterSizeCells: number;
  maxHashProbe: number;
}

const DEFAULT_MAX_RESIDENT_BYTES = 256 * 1024 * 1024;
const DEFAULT_MESHLET_MAX_VERTICES = 64;
const DEFAULT_MESHLET_MAX_TRIANGLES = 64;
const DEFAULT_SIMPLIFY_CLUSTER_SIZE_CELLS = 1.75;
const DEFAULT_MAX_HASH_PROBE = 96;

const MAX_HIERARCHY_LEVEL = 31;
const MAX_RESIDENT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MESHLET_VERTICES = 256;
const MAX_MESHLET_TRIANGLES = 256;
const MAX_SIMPLIFY_CLUSTER_SIZE_CELLS = 64;
const MAX_HASH_PROBE = 1024;

export const DEFAULT_GPU_CLOD_HIERARCHY_CONFIG: GpuClodHierarchyConfig = {
  enabled: false,
  renderResidentPages: true,
  readbackMinLevel: 1,
  residentMaxLevel: 0,
  maxResidentBytes: DEFAULT_MAX_RESIDENT_BYTES,
  meshlets: true,
  meshletMaxVertices: DEFAULT_MESHLET_MAX_VERTICES,
  meshletMaxTriangles: DEFAULT_MESHLET_MAX_TRIANGLES,
  gpuWeld: true,
  gpuSimplify: true,
  simplifyClusterSizeCells: DEFAULT_SIMPLIFY_CLUSTER_SIZE_CELLS,
  maxHashProbe: DEFAULT_MAX_HASH_PROBE,
};

function booleanFlag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return fallback;
}

function boundedInteger(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function boundedNumber(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseGpuClodHierarchyConfig(
  params: URLSearchParams,
  defaults: GpuClodHierarchyConfig = DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
): GpuClodHierarchyConfig {
  return {
    enabled: booleanFlag(params, "liveClodGpuHierarchy", defaults.enabled),
    renderResidentPages: booleanFlag(params, "liveClodGpuResidentRender", defaults.renderResidentPages),
    readbackMinLevel: boundedInteger(
      params,
      "liveClodGpuReadbackMinLevel",
      defaults.readbackMinLevel,
      0,
      MAX_HIERARCHY_LEVEL,
    ),
    residentMaxLevel: boundedInteger(
      params,
      "liveClodGpuResidentMaxLevel",
      defaults.residentMaxLevel,
      0,
      MAX_HIERARCHY_LEVEL,
    ),
    maxResidentBytes: boundedInteger(
      params,
      "liveClodGpuResidentBytes",
      defaults.maxResidentBytes,
      1,
      MAX_RESIDENT_BYTES,
    ),
    meshlets: booleanFlag(params, "liveClodGpuMeshlets", defaults.meshlets),
    meshletMaxVertices: boundedInteger(
      params,
      "liveClodGpuMeshletVertices",
      defaults.meshletMaxVertices,
      3,
      MAX_MESHLET_VERTICES,
    ),
    meshletMaxTriangles: boundedInteger(
      params,
      "liveClodGpuMeshletTriangles",
      defaults.meshletMaxTriangles,
      1,
      MAX_MESHLET_TRIANGLES,
    ),
    gpuWeld: booleanFlag(params, "liveClodGpuWeld", defaults.gpuWeld),
    gpuSimplify: booleanFlag(params, "liveClodGpuSimplify", defaults.gpuSimplify),
    simplifyClusterSizeCells: boundedNumber(
      params,
      "liveClodGpuSimplifyClusterCells",
      defaults.simplifyClusterSizeCells,
      0.01,
      MAX_SIMPLIFY_CLUSTER_SIZE_CELLS,
    ),
    maxHashProbe: boundedInteger(
      params,
      "liveClodGpuHashProbe",
      defaults.maxHashProbe,
      1,
      MAX_HASH_PROBE,
    ),
  };
}

export function shouldKeepGpuClodPageResident(
  config: GpuClodHierarchyConfig,
  level: number,
): boolean {
  return config.renderResidentPages
    && level <= config.residentMaxLevel
    && level < config.readbackMinLevel;
}

export function gpuClodHierarchyConfigFromWindow(): GpuClodHierarchyConfig {
  const search = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } })
    .window?.location?.search ?? "";
  return parseGpuClodHierarchyConfig(new URLSearchParams(search));
}
