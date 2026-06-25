import { load } from "js-yaml";
import clodRuntimeYaml from "./config/clod_runtime.yaml?raw";

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
