import type { PostProcessToneMapping } from "../../environment/postprocess.js";
import type { ClodAppState } from "./index.js";

function finiteParam(searchParams: URLSearchParams, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function flagParam(searchParams: URLSearchParams, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
    if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  }
  return null;
}

function toneMappingParam(searchParams: URLSearchParams): PostProcessToneMapping | null {
  const value = searchParams.get("toneMap") ?? searchParams.get("toneMapping");
  if (value === "aces" || value === "agx" || value === "linear" || value === "none") return value;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function apply(searchParams: URLSearchParams, keys: string[], setter: (value: number) => void): void {
  const value = finiteParam(searchParams, ...keys);
  if (value === null) return;
  setter(value);
}

function neutralGrade(state: ClodAppState): void {
  state.postProcessExposure = 1.0;
  state.postProcessContrast = 1.0;
  state.postProcessSaturation = 1.0;
  state.postProcessVignette = 0.0;
}

export function applyEnvironmentQueryOverrides(state: ClodAppState, searchParams: URLSearchParams): void {
  apply(searchParams, ["sunElevationDeg", "sunElevation"], (value) => {
    state.sunElevationDeg = clamp(value, -10, 90);
  });
  apply(searchParams, ["sunAzimuthDeg", "sunAzimuth"], (value) => {
    state.sunAzimuthDeg = ((value % 360) + 360) % 360;
  });
  apply(searchParams, ["sunIntensity"], (value) => {
    state.sunIntensity = Math.max(0, value);
  });
  apply(searchParams, ["skyIntensity"], (value) => {
    state.skyIntensity = Math.max(0, value);
  });
  apply(searchParams, ["groundIntensity"], (value) => {
    state.groundIntensity = Math.max(0, value);
  });
  apply(searchParams, ["exposure"], (value) => {
    state.exposure = Math.max(0, value);
  });
  apply(searchParams, ["hazeIntensity"], (value) => {
    state.hazeIntensity = Math.max(0, value);
  });

  const timings = flagParam(searchParams, "timings", "profile");
  if (timings !== null) state.profileEnabled = timings;

  const fx = flagParam(searchParams, "fx");
  if (fx === false) {
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.postProcessBloomEnabled = false;
    state.godRaysMode = "off";
    state.hazeIntensity = 0;
  }

  const postProcess = flagParam(searchParams, "postprocess", "postProcess");
  if (postProcess !== null) {
    state.postProcessEnabled = postProcess;
    if (!postProcess) state.postProcessDebugMode = "off";
  }

  const postMin = flagParam(searchParams, "postmin", "postMin");
  if (postMin === true) {
    state.postProcessEnabled = true;
    state.postProcessDebugMode = "output";
    neutralGrade(state);
    state.postProcessBloomEnabled = false;
    state.godRaysMode = "off";
  }

  const grade = flagParam(searchParams, "grade");
  if (grade === false) neutralGrade(state);

  const bloom = flagParam(searchParams, "bloom");
  if (bloom !== null) state.postProcessBloomEnabled = bloom;

  const fog = flagParam(searchParams, "fog");
  if (fog === false) {
    state.hazeIntensity = 0;
    state.godRaysMode = "off";
  }

  const godRays = flagParam(searchParams, "godRays", "godrays");
  if (godRays === false) state.godRaysMode = "off";

  const toneMap = toneMappingParam(searchParams);
  if (toneMap !== null) state.postProcessToneMapping = toneMap;
}
