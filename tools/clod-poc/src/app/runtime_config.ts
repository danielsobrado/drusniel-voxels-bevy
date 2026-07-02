import { load } from "js-yaml";
import clodRuntimeYaml from "./config/clod_runtime.yaml?raw";
import { DEFAULT_PAGE_GEOMETRY_CACHE_CONFIG, type PageGeometryCacheConfig } from "../terrain/geometry/page_geometry_cache.js";
import {
  DEFAULT_CLOD_RENDER_NODE_CACHE_CONFIG,
  type ClodRenderNodeCacheConfig,
} from "../terrain/rendering/clod_render_node_cache_config.js";

export interface ClodRuntimeConfig {
  runtime: {
    worldOptions: number[];
  };
  webgpuSelection: {
    errorMaxAgeFrames: number;
    dispatchIntervalFrames: number;
    parityIntervalFrames: number;
    errorTolerancePx: number;
  };
  terrainTextures: {
    textureArraySize: number;
  };
  nearField: {
    chunkGroupBuildBudget: number;
    maxCachedChunkGroups: number;
    evictDistanceMultiplier: number;
  };
  pageGeometryCache: PageGeometryCacheConfig;
  renderNodeCache: ClodRenderNodeCacheConfig;
  digging: {
    holdIntervalMs: number;
  };
  profiling: {
    slowFrameMs: number;
  };
}

export const DEFAULT_CLOD_RUNTIME_CONFIG: ClodRuntimeConfig = {
  runtime: {
    worldOptions: [2, 4, 8, 16, 32],
  },
  webgpuSelection: {
    errorMaxAgeFrames: 6,
    dispatchIntervalFrames: 2,
    parityIntervalFrames: 60,
    errorTolerancePx: 0.02,
  },
  terrainTextures: {
    textureArraySize: 512,
  },
  nearField: {
    chunkGroupBuildBudget: 1,
    maxCachedChunkGroups: 64,
    evictDistanceMultiplier: 2.5,
  },
  pageGeometryCache: DEFAULT_PAGE_GEOMETRY_CACHE_CONFIG,
  renderNodeCache: DEFAULT_CLOD_RENDER_NODE_CACHE_CONFIG,
  digging: {
    holdIntervalMs: 400,
  },
  profiling: {
    slowFrameMs: 24,
  },
};

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function worldOptions(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const parsed = value.map((entry) => Number(entry)).filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

export function parseClodRuntimeConfig(yamlText = clodRuntimeYaml): ClodRuntimeConfig {
  const defaults = DEFAULT_CLOD_RUNTIME_CONFIG;
  try {
    const raw = load(yamlText) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return defaults;
    const runtime = (raw.runtime ?? {}) as Record<string, unknown>;
    const webgpuSelection = (raw.webgpu_selection ?? {}) as Record<string, unknown>;
    const terrainTextures = (raw.terrain_textures ?? {}) as Record<string, unknown>;
    const nearField = (raw.near_field ?? {}) as Record<string, unknown>;
    const pageGeometryCache = (raw.page_geometry_cache ?? {}) as Record<string, unknown>;
    const renderNodeCache = (raw.render_node_cache ?? {}) as Record<string, unknown>;
    const digging = (raw.digging ?? {}) as Record<string, unknown>;
    const profiling = (raw.profiling ?? {}) as Record<string, unknown>;
    return {
      runtime: {
        worldOptions: worldOptions(runtime.world_options, defaults.runtime.worldOptions),
      },
      webgpuSelection: {
        errorMaxAgeFrames: positiveInt(
          webgpuSelection.error_max_age_frames,
          defaults.webgpuSelection.errorMaxAgeFrames,
        ),
        dispatchIntervalFrames: positiveInt(
          webgpuSelection.dispatch_interval_frames,
          defaults.webgpuSelection.dispatchIntervalFrames,
        ),
        parityIntervalFrames: positiveInt(
          webgpuSelection.parity_interval_frames,
          defaults.webgpuSelection.parityIntervalFrames,
        ),
        errorTolerancePx: positiveNumber(
          webgpuSelection.error_tolerance_px,
          defaults.webgpuSelection.errorTolerancePx,
        ),
      },
      terrainTextures: {
        textureArraySize: positiveInt(
          terrainTextures.texture_array_size,
          defaults.terrainTextures.textureArraySize,
        ),
      },
      nearField: {
        chunkGroupBuildBudget: positiveInt(
          nearField.chunk_group_build_budget,
          defaults.nearField.chunkGroupBuildBudget,
        ),
        maxCachedChunkGroups: positiveInt(
          nearField.max_cached_chunk_groups,
          defaults.nearField.maxCachedChunkGroups,
        ),
        evictDistanceMultiplier: positiveNumber(
          nearField.evict_distance_multiplier,
          defaults.nearField.evictDistanceMultiplier,
        ),
      },
      pageGeometryCache: {
        enabled: bool(pageGeometryCache.enabled, defaults.pageGeometryCache.enabled),
        maxEntries: positiveInt(
          pageGeometryCache.max_entries,
          defaults.pageGeometryCache.maxEntries,
        ),
        warnAtEntries: positiveInt(
          pageGeometryCache.warn_at_entries,
          defaults.pageGeometryCache.warnAtEntries,
        ),
      },
      renderNodeCache: {
        enabled: bool(renderNodeCache.enabled, defaults.renderNodeCache.enabled),
        maxInactiveNodes: positiveInt(
          renderNodeCache.max_inactive_nodes,
          defaults.renderNodeCache.maxInactiveNodes,
        ),
        pruneIntervalFrames: positiveInt(
          renderNodeCache.prune_interval_frames,
          defaults.renderNodeCache.pruneIntervalFrames,
        ),
        prefetchParent: bool(
          renderNodeCache.prefetch_parent,
          defaults.renderNodeCache.prefetchParent,
        ),
        prefetchChildren: bool(
          renderNodeCache.prefetch_children,
          defaults.renderNodeCache.prefetchChildren,
        ),
        maxPrefetchCreatesPerFrame: positiveInt(
          renderNodeCache.max_prefetch_creates_per_frame,
          defaults.renderNodeCache.maxPrefetchCreatesPerFrame,
        ),
        warnAtInactiveNodes: positiveInt(
          renderNodeCache.warn_at_inactive_nodes,
          defaults.renderNodeCache.warnAtInactiveNodes,
        ),
      },
      digging: {
        holdIntervalMs: positiveInt(digging.hold_interval_ms, defaults.digging.holdIntervalMs),
      },
      profiling: {
        slowFrameMs: positiveNumber(profiling.slow_frame_ms, defaults.profiling.slowFrameMs),
      },
    };
  } catch {
    return defaults;
  }
}

export function resolveSlowFrameMsThreshold(
  searchParams: URLSearchParams,
  defaultMs: number,
): number {
  const v = Number(searchParams.get("profileMs"));
  return Number.isFinite(v) && v > 0 ? v : defaultMs;
}
