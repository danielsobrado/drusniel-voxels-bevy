import {
  applyPostProcessQueryOverrides,
  parseAerialPerspectiveSettings,
  parsePostProcessSettings,
  type GodRaysMode,
} from "../environment/postprocess_settings.js";
import { DEFAULT_POSTFX_AUTO_EXPOSURE } from "./postfx_auto_exposure.js";
import { parsePostFxStageFlags, stageAllowed, type PostFxStage } from "./postfx_stage_flags.js";

export type PostFxCaseStageState = Record<PostFxStage, boolean>;

export interface PostFxCaseDiagnostics {
  postEnabled: boolean;
  postMin: boolean;
  stages: PostFxCaseStageState;
}

const STAGES: readonly PostFxStage[] = [
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

const BASE_POST_PROCESS_SETTINGS = {
  ...parsePostProcessSettings(),
  ...parseAerialPerspectiveSettings(),
};

function toSearchParams(input: URLSearchParams | Record<string, string>): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) params.set(key, value);
  return params;
}

function queryFlag(params: URLSearchParams, keys: readonly string[], fallback: boolean): boolean {
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
    if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  }
  return fallback;
}

function baseStageState(
  godRaysMode: GodRaysMode,
  settings: ReturnType<typeof applyPostProcessQueryOverrides>,
  params: URLSearchParams,
): PostFxCaseStageState {
  return {
    aerial: settings.aerialPerspectiveEnabled,
    autoExposure: queryFlag(
      params,
      ["autoExposure", "autoexposure"],
      DEFAULT_POSTFX_AUTO_EXPOSURE.enabled,
    ),
    bloom: settings.bloomEnabled,
    bounce: settings.bounceEnabled,
    clouds: settings.cloudsEnabled,
    colorScript: true,
    contact: settings.contactShadowsEnabled,
    froxels: settings.froxelsEnabled,
    godrays: godRaysMode !== "off",
    gtao: settings.gtaoEnabled,
    taa: settings.taaEnabled,
  };
}

export function postFxCaseDiagnostics(input: URLSearchParams | Record<string, string>): PostFxCaseDiagnostics {
  const params = toSearchParams(input);
  const flags = parsePostFxStageFlags(params);
  const settings = applyPostProcessQueryOverrides(BASE_POST_PROCESS_SETTINGS, params);
  const postEnabled = settings.enabled && settings.debugMode !== "off";
  const godRaysMode = settings.godRaysMode;
  const stages = baseStageState(godRaysMode, settings, params);

  for (const stage of STAGES) {
    stages[stage] = postEnabled && stages[stage] && stageAllowed(flags, stage);
  }

  // Match WebGpuPostProcessPipeline.effectiveFroxelsEnabled(): volumetric shafts force the
  // froxel ambience layer unless the froxel or god-rays stage was explicitly ablated.
  if (
    postEnabled
    && godRaysMode === "volumetric"
    && stages.godrays
    && stageAllowed(flags, "froxels")
  ) {
    stages.froxels = true;
  }

  return { postEnabled, postMin: flags.postMin, stages };
}

export function compactStageList(diagnostics: PostFxCaseDiagnostics): string {
  if (!diagnostics.postEnabled) return "off";
  const active = STAGES.filter((stage) => diagnostics.stages[stage]);
  return active.length > 0 ? active.join("+") : "none";
}
