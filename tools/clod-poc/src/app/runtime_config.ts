import { load } from "js-yaml";
import clodRuntimeYaml from "./config/clod_runtime.yaml?raw";
import { DEFAULT_PAGE_GEOMETRY_CACHE_CONFIG, type PageGeometryCacheConfig } from "../terrain/geometry/page_geometry_cache.js";
import {
  DEFAULT_CLOD_RENDER_NODE_CACHE_CONFIG,
  type ClodRenderNodeCacheConfig,
} from "../terrain/rendering/clod_render_node_cache_config.js";
import {
  DEFAULT_SELECTION_CUT_CACHE_CONFIG,
  type SelectionCutCacheConfig,
} from "../terrain/selection/selection_cut_cache.js";
import {
  DEFAULT_MATERIAL_CHURN_CONFIG,
  type MaterialChurnConfig,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  DEFAULT_RENDER_RESOLUTION_CONFIG,
} from "../rendering/render_resolution_config.js";
import {
  DEFAULT_CLOD_APPLY_BUDGET,
  type ClodApplyBudget,
} from "../terrain/rendering/clod_apply_queue.js";
import type {
  DynamicResolutionConfig,
  RenderResolutionConfig,
  RenderResolutionPreset,
} from "../rendering/render_resolution.js";
import type { StatsSyncThrottleConfig } from "./frame_loop/stats_sync_throttle.js";

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
  clodApply: ClodApplyBudget;
  selectionCutCache: SelectionCutCacheConfig;
  materialChurn: MaterialChurnConfig;
  renderResolution: RenderResolutionConfig;
  digging: {
    holdIntervalMs: number;
  };
  profiling: {
    slowFrameMs: number;
  };
  stats: StatsSyncThrottleConfig;
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
  clodApply: DEFAULT_CLOD_APPLY_BUDGET,
  selectionCutCache: DEFAULT_SELECTION_CUT_CACHE_CONFIG,
  materialChurn: DEFAULT_MATERIAL_CHURN_CONFIG,
  renderResolution: DEFAULT_RENDER_RESOLUTION_CONFIG,
  digging: {
    holdIntervalMs: 400,
  },
  profiling: {
    slowFrameMs: 24,
  },
  stats: {
    normalHz: 4,
    debugHz: 10,
    profileEveryFrame: true,
  },
};

let cachedBundledRuntimeConfig: ClodRuntimeConfig | null = null;

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
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

function renderResolutionPreset(value: unknown, fallback: RenderResolutionPreset): RenderResolutionPreset {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    dprCap: positiveNumber(raw.dpr_cap, fallback.dprCap),
    renderScale: positiveNumber(raw.render_scale, fallback.renderScale),
  };
}

function renderResolutionPresets(value: unknown, fallback: Record<string, RenderResolutionPreset>): Record<string, RenderResolutionPreset> {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const names = new Set([...Object.keys(fallback), ...Object.keys(raw)]);
  const presets: Record<string, RenderResolutionPreset> = {};
  for (const name of names) {
    presets[name] = renderResolutionPreset(raw[name], fallback[name] ?? DEFAULT_RENDER_RESOLUTION_CONFIG.presets.high);
  }
  return presets;
}

function dynamicResolutionConfig(value: unknown, fallback: DynamicResolutionConfig): DynamicResolutionConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    targetMs: positiveNumber(raw.target_ms ?? raw.targetMs, fallback.targetMs),
    minScale: positiveNumber(raw.min_scale ?? raw.minScale, fallback.minScale),
    maxScale: positiveNumber(raw.max_scale ?? raw.maxScale, fallback.maxScale),
    stepUp: positiveNumber(raw.step_up ?? raw.stepUp, fallback.stepUp),
    stepDown: positiveNumber(raw.step_down ?? raw.stepDown, fallback.stepDown),
    sampleWindowFrames: positiveInt(raw.sample_window_frames ?? raw.sampleWindowFrames, fallback.sampleWindowFrames),
    settleFrames: nonNegativeInt(raw.settle_frames ?? raw.settleFrames, fallback.settleFrames),
    upscaleHeadroomMs: positiveNumber(raw.upscale_headroom_ms ?? raw.upscaleHeadroomMs, fallback.upscaleHeadroomMs),
    downscaleOverMs: positiveNumber(raw.downscale_over_ms ?? raw.downscaleOverMs, fallback.downscaleOverMs),
  };
}

export function parseClodRuntimeConfig(yamlText = clodRuntimeYaml): ClodRuntimeConfig {
  if (yamlText === clodRuntimeYaml && cachedBundledRuntimeConfig) return cachedBundledRuntimeConfig;
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
    const clodApply = (raw.clod_apply ?? {}) as Record<string, unknown>;
    const selectionCutCache = (raw.selection_cut_cache ?? {}) as Record<string, unknown>;
    const materialChurn = (raw.material_churn ?? {}) as Record<string, unknown>;
    const renderResolution = (raw.render_resolution ?? {}) as Record<string, unknown>;
    const digging = (raw.digging ?? {}) as Record<string, unknown>;
    const profiling = (raw.profiling ?? {}) as Record<string, unknown>;
    const stats = (raw.stats ?? {}) as Record<string, unknown>;
    const parsed = {
      runtime: {
        worldOptions: worldOptions(runtime.world_options, defaults.runtime.worldOptions),
      },
      webgpuSelection: {
        errorMaxAgeFrames: positiveInt(webgpuSelection.error_max_age_frames, defaults.webgpuSelection.errorMaxAgeFrames),
        dispatchIntervalFrames: positiveInt(webgpuSelection.dispatch_interval_frames, defaults.webgpuSelection.dispatchIntervalFrames),
        parityIntervalFrames: positiveInt(webgpuSelection.parity_interval_frames, defaults.webgpuSelection.parityIntervalFrames),
        errorTolerancePx: positiveNumber(webgpuSelection.error_tolerance_px, defaults.webgpuSelection.errorTolerancePx),
      },
      terrainTextures: {
        textureArraySize: positiveInt(terrainTextures.texture_array_size, defaults.terrainTextures.textureArraySize),
      },
      nearField: {
        chunkGroupBuildBudget: positiveInt(nearField.chunk_group_build_budget, defaults.nearField.chunkGroupBuildBudget),
        maxCachedChunkGroups: positiveInt(nearField.max_cached_chunk_groups, defaults.nearField.maxCachedChunkGroups),
        evictDistanceMultiplier: positiveNumber(nearField.evict_distance_multiplier, defaults.nearField.evictDistanceMultiplier),
      },
      pageGeometryCache: {
        enabled: bool(pageGeometryCache.enabled, defaults.pageGeometryCache.enabled),
        maxEntries: positiveInt(pageGeometryCache.max_entries, defaults.pageGeometryCache.maxEntries),
        warnAtEntries: positiveInt(pageGeometryCache.warn_at_entries, defaults.pageGeometryCache.warnAtEntries),
      },
      renderNodeCache: {
        enabled: bool(renderNodeCache.enabled, defaults.renderNodeCache.enabled),
        maxInactiveNodes: positiveInt(renderNodeCache.max_inactive_nodes, defaults.renderNodeCache.maxInactiveNodes),
        pruneIntervalFrames: positiveInt(renderNodeCache.prune_interval_frames, defaults.renderNodeCache.pruneIntervalFrames),
        prefetchParent: bool(renderNodeCache.prefetch_parent, defaults.renderNodeCache.prefetchParent),
        prefetchChildren: bool(renderNodeCache.prefetch_children, defaults.renderNodeCache.prefetchChildren),
        maxPrefetchCreatesPerFrame: positiveInt(renderNodeCache.max_prefetch_creates_per_frame, defaults.renderNodeCache.maxPrefetchCreatesPerFrame),
        warnAtInactiveNodes: positiveInt(renderNodeCache.warn_at_inactive_nodes, defaults.renderNodeCache.warnAtInactiveNodes),
        evictGeometryWithRenderNode: bool(renderNodeCache.evict_geometry_with_render_node, defaults.renderNodeCache.evictGeometryWithRenderNode),
      },
      clodApply: {
        enabled: bool(clodApply.enabled, defaults.clodApply.enabled),
        maxApplyMsPerFrame: positiveNumber(clodApply.max_apply_ms_per_frame, defaults.clodApply.maxApplyMsPerFrame),
        maxGeometryJobsPerFrame: positiveInt(clodApply.max_geometry_jobs_per_frame, defaults.clodApply.maxGeometryJobsPerFrame),
        maxColliderJobsPerFrame: positiveInt(clodApply.max_collider_jobs_per_frame, defaults.clodApply.maxColliderJobsPerFrame),
        keepStaleVisible: bool(clodApply.keep_stale_visible, defaults.clodApply.keepStaleVisible),
        prioritizeLod0: bool(clodApply.prioritize_lod0, defaults.clodApply.prioritizeLod0),
        prioritizeNearCamera: bool(clodApply.prioritize_near_camera, defaults.clodApply.prioritizeNearCamera),
        colliderMaxDelayFrames: positiveInt(clodApply.collider_max_delay_frames, defaults.clodApply.colliderMaxDelayFrames),
        debugLogSpikes: bool(clodApply.debug_log_spikes, defaults.clodApply.debugLogSpikes),
        spikeLogThresholdMs: positiveNumber(clodApply.spike_log_threshold_ms, defaults.clodApply.spikeLogThresholdMs),
      },
      selectionCutCache: {
        enabled: bool(selectionCutCache.enabled, defaults.selectionCutCache.enabled),
        cameraCellSizeM: positiveNumber(selectionCutCache.camera_cell_size_m, defaults.selectionCutCache.cameraCellSizeM),
        cameraHeightCellSizeM: positiveNumber(selectionCutCache.camera_height_cell_size_m, defaults.selectionCutCache.cameraHeightCellSizeM),
        targetCellSizeM: positiveNumber(selectionCutCache.target_cell_size_m, defaults.selectionCutCache.targetCellSizeM),
        angleBucketDeg: positiveNumber(selectionCutCache.angle_bucket_deg, defaults.selectionCutCache.angleBucketDeg),
        thresholdBucketPx: positiveNumber(selectionCutCache.threshold_bucket_px, defaults.selectionCutCache.thresholdBucketPx),
        bubbleCenterCellSizeM: positiveNumber(selectionCutCache.bubble_center_cell_size_m, defaults.selectionCutCache.bubbleCenterCellSizeM),
        maxReuseFrames: positiveInt(selectionCutCache.max_reuse_frames, defaults.selectionCutCache.maxReuseFrames),
      },
      materialChurn: {
        enabled: bool(materialChurn.enabled, defaults.materialChurn.enabled),
        collectMaterialVersions: bool(materialChurn.collect_material_versions, defaults.materialChurn.collectMaterialVersions),
        collectRendererPrograms: bool(materialChurn.collect_renderer_programs, defaults.materialChurn.collectRendererPrograms),
        logSpikeWarnings: bool(materialChurn.log_spike_warnings, defaults.materialChurn.logSpikeWarnings),
        spikeWarnThresholdPerFrame: positiveInt(materialChurn.spike_warn_threshold_per_frame, defaults.materialChurn.spikeWarnThresholdPerFrame),
        maxTrackedMaterials: positiveInt(materialChurn.max_tracked_materials, defaults.materialChurn.maxTrackedMaterials),
      },
      renderResolution: {
        dprCap: positiveNumber(renderResolution.dpr_cap, defaults.renderResolution.dprCap),
        renderScale: positiveNumber(renderResolution.render_scale, defaults.renderResolution.renderScale),
        minEffectivePixelRatio: positiveNumber(renderResolution.min_effective_pixel_ratio, defaults.renderResolution.minEffectivePixelRatio),
        maxEffectivePixelRatio: positiveNumber(renderResolution.max_effective_pixel_ratio, defaults.renderResolution.maxEffectivePixelRatio),
        dynamic: dynamicResolutionConfig(renderResolution.dynamic_resolution ?? renderResolution.dynamic, defaults.renderResolution.dynamic),
        presets: renderResolutionPresets(renderResolution.presets, defaults.renderResolution.presets),
      },
      digging: {
        holdIntervalMs: positiveInt(digging.hold_interval_ms, defaults.digging.holdIntervalMs),
      },
      profiling: {
        slowFrameMs: positiveNumber(profiling.slow_frame_ms, defaults.profiling.slowFrameMs),
      },
      stats: {
        normalHz: positiveNumber(stats.normal_hz, defaults.stats.normalHz),
        debugHz: positiveNumber(stats.debug_hz, defaults.stats.debugHz),
        profileEveryFrame: bool(stats.profile_every_frame, defaults.stats.profileEveryFrame),
      },
    };
    if (yamlText === clodRuntimeYaml) cachedBundledRuntimeConfig = parsed;
    return parsed;
  } catch {
    return defaults;
  }
}

export function resolveSlowFrameMsThreshold(searchParams: URLSearchParams, defaultMs: number): number {
  const v = Number(searchParams.get("profileMs"));
  return Number.isFinite(v) && v > 0 ? v : defaultMs;
}
