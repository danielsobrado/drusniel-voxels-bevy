import {
  DEFAULT_RENDER_RESOLUTION_CONFIG,
  DEFAULT_RENDER_RESOLUTION_PRESET,
} from "./render_resolution_config.js";

export type RenderResolutionPresetName = "performance100" | "low" | "medium" | "high" | "ultra" | "custom" | string;

export interface RenderResolutionPreset {
  dprCap: number;
  renderScale: number;
}

export interface RenderResolutionConfig {
  dprCap: number;
  renderScale: number;
  minEffectivePixelRatio: number;
  maxEffectivePixelRatio: number;
  presets: Record<string, RenderResolutionPreset>;
}

export interface RenderResolutionInput {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  presetName?: RenderResolutionPresetName;
  overrideDprCap?: number;
  overrideRenderScale?: number;
}

export interface RenderResolutionResult {
  cssWidth: number;
  cssHeight: number;
  rawDevicePixelRatio: number;
  dprCap: number;
  renderScale: number;
  cappedDevicePixelRatio: number;
  effectivePixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  presetName: string;
}

export interface RenderResolutionQueryOverrides {
  presetName?: string;
  overrideDprCap?: number;
  overrideRenderScale?: number;
}

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveOr(value: unknown, fallback: number): number {
  return finitePositive(value) ?? fallback;
}

function safeCssSize(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeEffectiveBounds(config: RenderResolutionConfig): { min: number; max: number } {
  const defaults = DEFAULT_RENDER_RESOLUTION_CONFIG;
  const min = positiveOr(config.minEffectivePixelRatio, defaults.minEffectivePixelRatio);
  const max = positiveOr(config.maxEffectivePixelRatio, defaults.maxEffectivePixelRatio);
  if (max < min) {
    return {
      min: defaults.minEffectivePixelRatio,
      max: defaults.maxEffectivePixelRatio,
    };
  }
  return { min, max };
}

function firstParam(searchParams: URLSearchParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value !== null && value.trim() !== "") return value;
  }
  return null;
}

export function resolveRenderResolutionQueryOverrides(searchParams: URLSearchParams): RenderResolutionQueryOverrides {
  const presetName = firstParam(searchParams, ["quality_preset", "qualityPreset", "render_preset", "renderPreset"]);
  const dprCap = finitePositive(firstParam(searchParams, ["dpr_cap", "dprCap"]));
  const renderScale = finitePositive(firstParam(searchParams, ["render_scale", "renderScale"]));

  return {
    presetName: presetName ?? undefined,
    overrideDprCap: dprCap ?? undefined,
    overrideRenderScale: renderScale ?? undefined,
  };
}

export function resolveRenderResolution(
  config: RenderResolutionConfig,
  input: RenderResolutionInput,
): RenderResolutionResult {
  const defaults = DEFAULT_RENDER_RESOLUTION_CONFIG;
  const cssWidth = safeCssSize(input.cssWidth);
  const cssHeight = safeCssSize(input.cssHeight);
  const rawDevicePixelRatio = positiveOr(input.devicePixelRatio, 1.0);
  const requestedPresetName = input.presetName ?? DEFAULT_RENDER_RESOLUTION_PRESET;
  const preset = requestedPresetName === "custom"
    ? undefined
    : config.presets[requestedPresetName] ?? defaults.presets[requestedPresetName];
  const fallbackPreset = config.presets[DEFAULT_RENDER_RESOLUTION_PRESET] ?? defaults.presets[DEFAULT_RENDER_RESOLUTION_PRESET];
  const effectivePresetName = requestedPresetName === "custom"
    ? "custom"
    : preset
      ? requestedPresetName
      : DEFAULT_RENDER_RESOLUTION_PRESET;
  const resolvedPreset = preset ?? fallbackPreset;

  const dprCap = positiveOr(
    input.overrideDprCap ?? resolvedPreset?.dprCap ?? config.dprCap,
    defaults.dprCap,
  );
  const renderScale = positiveOr(
    input.overrideRenderScale ?? resolvedPreset?.renderScale ?? config.renderScale,
    defaults.renderScale,
  );
  const { min, max } = safeEffectiveBounds(config);
  const cappedDevicePixelRatio = Math.min(rawDevicePixelRatio, dprCap);
  const effectivePixelRatio = clamp(cappedDevicePixelRatio * renderScale, min, max);

  return {
    cssWidth,
    cssHeight,
    rawDevicePixelRatio,
    dprCap,
    renderScale,
    cappedDevicePixelRatio,
    effectivePixelRatio,
    physicalWidth: Math.max(1, Math.floor(cssWidth * effectivePixelRatio)),
    physicalHeight: Math.max(1, Math.floor(cssHeight * effectivePixelRatio)),
    presetName: effectivePresetName,
  };
}
