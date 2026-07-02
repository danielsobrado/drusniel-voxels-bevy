import {
  resolveRenderResolution,
  resolveRenderResolutionQueryOverrides,
  type RenderResolutionConfig,
  type RenderResolutionResult,
} from "./render_resolution.js";
import { DEFAULT_RENDER_RESOLUTION_PRESET } from "./render_resolution_config.js";

export const RENDER_RESOLUTION_CHANGED_EVENT = "drusniel-render-resolution-changed";

export interface RenderResolutionChangedEventDetail {
  resolution: RenderResolutionResult;
}

export interface RenderResolutionRuntimeSettings {
  presetName: string;
  dprCap: number;
  renderScale: number;
}

export interface RenderResolutionDebugReadout {
  rawDevicePixelRatio: number;
  dprCap: number;
  renderScale: number;
  effectivePixelRatio: number;
  physicalSize: string;
}

export interface RenderResolutionRenderer {
  setPixelRatio(pixelRatio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}

export interface RenderResolutionCamera {
  aspect: number;
  updateProjectionMatrix(): void;
}

export interface RenderResolutionApplyInput {
  renderer: RenderResolutionRenderer;
  camera: RenderResolutionCamera;
}

export interface RenderResolutionApplyResult {
  resolution: RenderResolutionResult;
  changed: boolean;
}

export interface RenderResolutionRuntime {
  readonly settings: RenderResolutionRuntimeSettings;
  current(): RenderResolutionResult;
  readout(): RenderResolutionDebugReadout;
  presetNames(): string[];
  applyPreset(presetName: string): void;
  setCustomDprCap(value: number): void;
  setCustomRenderScale(value: number): void;
  resolveCurrentViewport(): RenderResolutionResult;
  markApplied(resolution: RenderResolutionResult): void;
  applyCurrentViewport(input: RenderResolutionApplyInput): RenderResolutionApplyResult;
}

declare global {
  interface Window {
    __drusnielRenderResolution?: RenderResolutionRuntime;
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function initialPresetName(config: RenderResolutionConfig, requested: string | undefined): string {
  if (requested && config.presets[requested]) return requested;
  return config.presets[DEFAULT_RENDER_RESOLUTION_PRESET] ? DEFAULT_RENDER_RESOLUTION_PRESET : "custom";
}

function initialSettings(config: RenderResolutionConfig, searchParams: URLSearchParams): RenderResolutionRuntimeSettings {
  const query = resolveRenderResolutionQueryOverrides(searchParams);
  const presetName = initialPresetName(config, query.presetName);
  const preset = config.presets[presetName];
  const hasManualOverride = query.overrideDprCap !== undefined || query.overrideRenderScale !== undefined;

  return {
    presetName: hasManualOverride ? "custom" : presetName,
    dprCap: query.overrideDprCap ?? preset?.dprCap ?? config.dprCap,
    renderScale: query.overrideRenderScale ?? preset?.renderScale ?? config.renderScale,
  };
}

function emitResolutionChanged(resolution: RenderResolutionResult): void {
  window.dispatchEvent(new CustomEvent<RenderResolutionChangedEventDetail>(
    RENDER_RESOLUTION_CHANGED_EVENT,
    { detail: { resolution } },
  ));
}

export function createRenderResolutionRuntime(
  config: RenderResolutionConfig,
  searchParams: URLSearchParams,
): RenderResolutionRuntime {
  const settings = initialSettings(config, searchParams);
  let currentResolution = resolveRenderResolution(config, {
    cssWidth: 1,
    cssHeight: 1,
    devicePixelRatio: 1,
    presetName: settings.presetName,
    overrideDprCap: settings.dprCap,
    overrideRenderScale: settings.renderScale,
  });

  const resolveCurrentViewport = () => resolveRenderResolution(config, {
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    presetName: settings.presetName,
    overrideDprCap: settings.dprCap,
    overrideRenderScale: settings.renderScale,
  });

  const markApplied = (resolution: RenderResolutionResult) => {
    currentResolution = resolution;
  };

  const changedSinceLastApply = (resolution: RenderResolutionResult): boolean =>
    resolution.cssWidth !== currentResolution.cssWidth
    || resolution.cssHeight !== currentResolution.cssHeight
    || resolution.effectivePixelRatio !== currentResolution.effectivePixelRatio;

  const applyCurrentViewport = ({ renderer, camera }: RenderResolutionApplyInput): RenderResolutionApplyResult => {
    const resolution = resolveCurrentViewport();
    const changed = changedSinceLastApply(resolution);
    if (changed) {
      renderer.setPixelRatio(resolution.effectivePixelRatio);
      renderer.setSize(resolution.cssWidth, resolution.cssHeight);
      camera.aspect = resolution.cssWidth / resolution.cssHeight;
      camera.updateProjectionMatrix();
    }
    markApplied(resolution);
    if (changed) emitResolutionChanged(resolution);
    return { resolution, changed };
  };

  const applyPreset = (presetName: string) => {
    const preset = config.presets[presetName];
    if (!preset) return;
    settings.presetName = presetName;
    settings.dprCap = preset.dprCap;
    settings.renderScale = preset.renderScale;
  };

  const setCustomDprCap = (value: number) => {
    if (!isPositiveFinite(value)) return;
    settings.presetName = "custom";
    settings.dprCap = value;
  };

  const setCustomRenderScale = (value: number) => {
    if (!isPositiveFinite(value)) return;
    settings.presetName = "custom";
    settings.renderScale = value;
  };

  return {
    settings,
    current: () => currentResolution,
    readout: () => ({
      rawDevicePixelRatio: rounded(currentResolution.rawDevicePixelRatio),
      dprCap: rounded(currentResolution.dprCap),
      renderScale: rounded(currentResolution.renderScale),
      effectivePixelRatio: rounded(currentResolution.effectivePixelRatio),
      physicalSize: `${currentResolution.physicalWidth}x${currentResolution.physicalHeight}`,
    }),
    presetNames: () => Array.from(new Set([...Object.keys(config.presets), "custom"])),
    applyPreset,
    setCustomDprCap,
    setCustomRenderScale,
    resolveCurrentViewport,
    markApplied,
    applyCurrentViewport,
  };
}
