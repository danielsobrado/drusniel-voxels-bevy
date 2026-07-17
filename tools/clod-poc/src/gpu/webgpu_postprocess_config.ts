import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../environment/postprocess.js";
import type { PostFxStage } from "./postfx_stage_flags.js";

export const POSTFX_GRAPH_STAGES: readonly PostFxStage[] = [
  "aerial",
  "autoExposure",
  "bloom",
  "bounce",
  "clouds",
  "colorScript",
  "contact",
  "froxels",
  "godrays",
  "gtao",
  "taa",
] as const;

export interface WebGpuPostProcessStageSelection {
  bounce: boolean;
  clouds: boolean;
  froxels: boolean;
  gtao: boolean;
}

export function resolveWebGpuPostProcessStages(
  settings: Required<PostProcessSettings>,
  isAllowed: (stage: PostFxStage) => boolean,
): WebGpuPostProcessStageSelection {
  return {
    bounce: settings.bounceEnabled && isAllowed("bounce"),
    clouds: settings.cloudsEnabled && isAllowed("clouds"),
    froxels: settings.froxelsEnabled && isAllowed("froxels"),
    gtao: settings.gtaoEnabled && isAllowed("gtao"),
  };
}

export function withPostProcessDefaults(settings: Partial<PostProcessSettings>): Required<PostProcessSettings> {
  return { ...DEFAULT_POST_PROCESS_SETTINGS, ...settings };
}

function numberKey(value: number | undefined): string {
  return Number(value ?? 0).toFixed(4);
}

export function webGpuPostProcessGraphKey(settings: Required<PostProcessSettings>): string {
  return [
    settings.enabled ? "1" : "0",
    settings.debugMode,
    settings.bloomEnabled ? "bloom" : "no-bloom",
    numberKey(settings.bloomThreshold),
    numberKey(settings.bloomStrength),
    numberKey(settings.bloomRadius),
    settings.taaEnabled ? "taa" : "no-taa",
    settings.aerialPerspectiveEnabled ? "aerial" : "no-aerial",
    settings.contactShadowsEnabled ? "contact" : "no-contact",
    settings.cloudsEnabled ? "clouds" : "no-clouds",
    settings.gtaoEnabled ? "gtao" : "no-gtao",
    settings.froxelsEnabled ? "froxels" : "no-froxels",
    settings.bounceEnabled ? "bounce" : "no-bounce",
    `godrays-${settings.godRaysMode}`,
  ].join("|");
}

/** True when the post-process output graph must be recompiled. */
export function postProcessOutputGraphDirty(
  current: PostProcessSettings,
  settings: Partial<PostProcessSettings>,
): boolean {
  const currentResolved = withPostProcessDefaults(current);
  const nextResolved = withPostProcessDefaults({ ...currentResolved, ...settings });
  return webGpuPostProcessGraphKey(currentResolved) !== webGpuPostProcessGraphKey(nextResolved);
}

export function searchParams(): URLSearchParams | null {
  if (typeof globalThis.location === "undefined") return null;
  return new URLSearchParams(globalThis.location.search);
}

export function queryFlag(keys: string[], fallback: boolean): boolean {
  const params = searchParams();
  if (!params) return fallback;
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
    if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  }
  return fallback;
}

export function queryValue(keys: string[]): string | null {
  const params = searchParams();
  if (!params) return null;
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null) return value;
  }
  return null;
}
