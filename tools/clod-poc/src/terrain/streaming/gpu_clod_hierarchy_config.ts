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

function nonNegativeInteger(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function positiveInteger(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function positiveNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseGpuClodHierarchyConfig(
  params: URLSearchParams,
  defaults: GpuClodHierarchyConfig = DEFAULT_GPU_CLOD_HIERARCHY_CONFIG,
): GpuClodHierarchyConfig {
  return {
    enabled: booleanFlag(params, "liveClodGpuHierarchy", defaults.enabled),
    renderResidentPages: booleanFlag(params, "liveClodGpuResidentRender", defaults.renderResidentPages),
    readbackMinLevel: nonNegativeInteger(params, "liveClodGpuReadbackMinLevel", defaults.readbackMinLevel),
    residentMaxLevel: nonNegativeInteger(params, "liveClodGpuResidentMaxLevel", defaults.residentMaxLevel),
    maxResidentBytes: positiveInteger(params, "liveClodGpuResidentBytes", defaults.maxResidentBytes),
    meshlets: booleanFlag(params, "liveClodGpuMeshlets", defaults.meshlets),
    meshletMaxVertices: positiveInteger(params, "liveClodGpuMeshletVertices", defaults.meshletMaxVertices),
    meshletMaxTriangles: positiveInteger(params, "liveClodGpuMeshletTriangles", defaults.meshletMaxTriangles),
    gpuWeld: booleanFlag(params, "liveClodGpuWeld", defaults.gpuWeld),
    gpuSimplify: booleanFlag(params, "liveClodGpuSimplify", defaults.gpuSimplify),
    simplifyClusterSizeCells: positiveNumber(
      params,
      "liveClodGpuSimplifyClusterCells",
      defaults.simplifyClusterSizeCells,
    ),
    maxHashProbe: positiveInteger(params, "liveClodGpuHashProbe", defaults.maxHashProbe),
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
