import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import { INFINITE_ISLANDS_SCENE } from "../world_mode.js";

export function numberParam(searchParams: URLSearchParams, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function booleanParam(searchParams: URLSearchParams, keys: readonly string[], fallback: boolean): boolean {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    return raw !== "0" && raw !== "false";
  }
  return fallback;
}

export const DEFAULT_INFINITE_BOOTSTRAP_WORLD_PAGES = 2;
export const HEIGHTFIELD_RASTER_REASON_CODES = {
  enabled: 0,
  invalid_world_cells: 1,
  sample_budget: 2,
  byte_budget: 3,
} as const;

export type StartupTimings = Record<string, number>;

export function measure<T>(timings: StartupTimings, key: string, fn: () => T): T {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    timings[key] = performance.now() - startedAt;
  }
}

export async function measureAsync<T>(timings: StartupTimings, key: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    timings[key] = performance.now() - startedAt;
  }
}

export function addTiming(timings: StartupTimings, key: string, ms: number): void {
  timings[key] = (timings[key] ?? 0) + ms;
}

export function configuredWorldPages(
  stagedImport: VoxelProjectArchiveContents | null,
  clodRuntime: ClodRuntimeConfig,
  searchParams: URLSearchParams,
  queries: {
    queryGrassPerfScene: boolean;
    queryTreePerfScene: boolean;
    queryForestFloorScene: boolean;
    queryLongViewScene: boolean;
    queryBorderOceanScene: boolean;
  },
  borderOceanDefaultWorldPages: number,
): number {
  const requested = Number(searchParams.get("world"));
  return stagedImport?.manifest.worldSize ?? (
    clodRuntime.runtime.worldOptions.includes(requested)
      ? requested
      : queries.queryGrassPerfScene || queries.queryTreePerfScene || queries.queryForestFloorScene || queries.queryLongViewScene || queries.queryBorderOceanScene
        ? queries.queryBorderOceanScene
          ? borderOceanDefaultWorldPages
          : 16
        : 8
  );
}

export function startupWorldPages(
  configuredWorld: number,
  stagedImport: VoxelProjectArchiveContents | null,
  clodRuntime: ClodRuntimeConfig,
  searchParams: URLSearchParams,
  sceneName: string,
): number {
  if (stagedImport) return configuredWorld;
  const requestedStartupWorld = Number(searchParams.get("infiniteStartupWorld") ?? searchParams.get("startupWorld"));
  if (clodRuntime.runtime.worldOptions.includes(requestedStartupWorld)) {
    return Math.min(requestedStartupWorld, configuredWorld);
  }
  if (sceneName === INFINITE_ISLANDS_SCENE && searchParams.get("acceptance") === "1") {
    return Math.min(DEFAULT_INFINITE_BOOTSTRAP_WORLD_PAGES, configuredWorld);
  }
  return configuredWorld;
}
