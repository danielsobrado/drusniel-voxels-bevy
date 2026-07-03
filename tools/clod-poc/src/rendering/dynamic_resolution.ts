import type { DynamicResolutionConfig } from "./render_resolution.js";
import type {
  RenderResolutionApplyInput,
  RenderResolutionRuntime,
} from "./render_resolution_runtime.js";

export type DynamicResolutionReason =
  | "disabled"
  | "mode_disabled"
  | "warming"
  | "settling"
  | "stable"
  | "scale_down"
  | "scale_up";

export interface DynamicResolutionStats {
  enabled: boolean;
  active: boolean;
  frameMsAvg: number;
  targetMs: number;
  renderScale: number;
  minScale: number;
  maxScale: number;
  adjustments: number;
  reason: DynamicResolutionReason;
}

export interface DynamicResolutionUpdateInput extends RenderResolutionApplyInput {
  frameMs: number;
  frameIndex: number;
}

export interface DynamicResolutionController {
  update(input: DynamicResolutionUpdateInput): DynamicResolutionStats;
  stats(): DynamicResolutionStats;
}

const QUERY_FORCE_ON = new Set(["1", "true", "on"]);
const QUERY_FORCE_OFF = new Set(["0", "false", "off"]);
const DETERMINISTIC_MODE_FLAGS = [
  "perfProbe",
  "gpuTiming",
  "benchmark",
  "bench",
  "acceptance",
  "acceptanceMode",
  "qa",
];

function finitePositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function queryEnabledOverride(searchParams: URLSearchParams): boolean | null {
  const raw = searchParams.get("dynamicResolution") ?? searchParams.get("dynamic_resolution");
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (QUERY_FORCE_ON.has(normalized)) return true;
  if (QUERY_FORCE_OFF.has(normalized)) return false;
  return null;
}

function deterministicModeActive(searchParams: URLSearchParams): boolean {
  return DETERMINISTIC_MODE_FLAGS.some((key) => {
    const value = searchParams.get(key);
    return value === "1" || value === "true";
  });
}

function resolveActive(config: DynamicResolutionConfig, searchParams: URLSearchParams): boolean {
  const override = queryEnabledOverride(searchParams);
  if (override !== null) return override;
  if (deterministicModeActive(searchParams)) return false;
  return config.enabled;
}

function makeInitialStats(
  config: DynamicResolutionConfig,
  runtime: RenderResolutionRuntime | null,
  active: boolean,
  reason: DynamicResolutionReason,
): DynamicResolutionStats {
  const minScale = Math.min(config.minScale, config.maxScale);
  const maxScale = Math.max(config.minScale, config.maxScale);
  return {
    enabled: config.enabled,
    active,
    frameMsAvg: 0,
    targetMs: config.targetMs,
    renderScale: runtime?.settings.renderScale ?? maxScale,
    minScale,
    maxScale,
    adjustments: 0,
    reason,
  };
}

export function createDynamicResolutionController(
  config: DynamicResolutionConfig,
  runtime: RenderResolutionRuntime | null,
  searchParams = new URLSearchParams(),
): DynamicResolutionController {
  const active = runtime !== null && resolveActive(config, searchParams);
  const stats = makeInitialStats(
    config,
    runtime,
    active,
    active ? "warming" : deterministicModeActive(searchParams) ? "mode_disabled" : "disabled",
  );
  const frameWindow: number[] = [];
  let settleFramesRemaining = 0;

  const setReason = (reason: DynamicResolutionReason) => {
    stats.reason = reason;
    return { ...stats };
  };

  const recordFrame = (frameMs: number): number => {
    const safeFrameMs = finitePositive(frameMs, stats.targetMs);
    frameWindow.push(safeFrameMs);
    const maxSamples = Math.max(1, Math.floor(config.sampleWindowFrames));
    while (frameWindow.length > maxSamples) frameWindow.shift();
    const avg = frameWindow.reduce((sum, sample) => sum + sample, 0) / frameWindow.length;
    stats.frameMsAvg = rounded(avg);
    return avg;
  };

  const applyScale = (nextScale: number, input: RenderResolutionUpdateInput, reason: DynamicResolutionReason) => {
    if (!runtime) return setReason("disabled");
    const currentScale = runtime.settings.renderScale;
    if (Math.abs(nextScale - currentScale) < 0.001) return setReason("stable");
    runtime.setCustomRenderScale(rounded(nextScale));
    runtime.applyCurrentViewport({ renderer: input.renderer, camera: input.camera });
    stats.renderScale = runtime.settings.renderScale;
    stats.adjustments += 1;
    settleFramesRemaining = Math.max(0, Math.floor(config.settleFrames));
    return setReason(reason);
  };

  return {
    update(input: DynamicResolutionUpdateInput): DynamicResolutionStats {
      stats.renderScale = runtime?.settings.renderScale ?? stats.renderScale;
      if (!active || !runtime) return setReason(stats.reason === "mode_disabled" ? "mode_disabled" : "disabled");

      const avg = recordFrame(input.frameMs);
      if (frameWindow.length < Math.max(1, Math.floor(config.sampleWindowFrames))) return setReason("warming");
      if (settleFramesRemaining > 0) {
        settleFramesRemaining -= 1;
        return setReason("settling");
      }

      const minScale = Math.min(config.minScale, config.maxScale);
      const maxScale = Math.max(config.minScale, config.maxScale);
      const scale = clamp(runtime.settings.renderScale, minScale, maxScale);
      stats.renderScale = rounded(scale);
      stats.minScale = minScale;
      stats.maxScale = maxScale;

      const downThreshold = config.targetMs + config.downscaleOverMs;
      const upThreshold = Math.max(0.1, config.targetMs - config.upscaleHeadroomMs);

      if (avg > downThreshold && scale > minScale) {
        return applyScale(Math.max(minScale, scale - config.stepDown), input, "scale_down");
      }
      if (avg < upThreshold && scale < maxScale) {
        return applyScale(Math.min(maxScale, scale + config.stepUp), input, "scale_up");
      }
      return setReason("stable");
    },
    stats: () => ({ ...stats }),
  };
}
