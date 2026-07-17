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

const DEFAULT_STAGE_STATE: PostFxCaseStageState = {
  aerial: true,
  autoExposure: true,
  bloom: true,
  bounce: false,
  clouds: true,
  colorScript: true,
  contact: false,
  froxels: false,
  // The yaml default mode is volumetric, so the stage is active unless ablated or ?godrays=off.
  godrays: true,
  gtao: false,
  taa: true,
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

export function postFxCaseDiagnostics(input: URLSearchParams | Record<string, string>): PostFxCaseDiagnostics {
  const params = toSearchParams(input);
  const flags = parsePostFxStageFlags(params);
  const postEnabled = queryFlag(params, ["fx", "post", "postprocess"], true);
  const stages = { ...DEFAULT_STAGE_STATE };

  stages.contact = queryFlag(params, ["contact", "contactShadows", "contactshadows"], stages.contact);
  stages.gtao = queryFlag(params, ["gtao", "ao", "ambientOcclusion", "ambientocclusion"], stages.gtao);
  stages.bounce = queryFlag(params, ["bounce", "ssBounce", "ssbounce", "colorBounce", "colorbounce"], stages.bounce);
  stages.froxels = queryFlag(params, ["froxels", "froxel", "volumetrics", "volumetricFog", "volumetricfog"], stages.froxels);
  stages.autoExposure = queryFlag(params, ["autoExposure", "autoexposure"], stages.autoExposure);
  const godRaysRaw = params.get("godRays") ?? params.get("godrays");
  if (godRaysRaw !== null) {
    const value = godRaysRaw.trim().toLowerCase();
    if (value === "cheap" || value === "heavy" || value === "volumetric") stages.godrays = true;
    else stages.godrays = queryFlag(params, ["godRays", "godrays"], stages.godrays);
  }

  for (const stage of STAGES) {
    stages[stage] = postEnabled && stages[stage] && stageAllowed(flags, stage);
  }

  return { postEnabled, postMin: flags.postMin, stages };
}

export function compactStageList(diagnostics: PostFxCaseDiagnostics): string {
  if (!diagnostics.postEnabled) return "off";
  const active = STAGES.filter((stage) => diagnostics.stages[stage]);
  return active.length > 0 ? active.join("+") : "none";
}
