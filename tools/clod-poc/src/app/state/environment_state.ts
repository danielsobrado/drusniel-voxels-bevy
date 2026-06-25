import type { ProjectSessionState } from "../../project_archive.js";
import { DEFAULT_ENVIRONMENT_SETTINGS } from "../../environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../../postprocess.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface EnvironmentSliceState {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  skyIntensity: number;
  groundIntensity: number;
  exposure: number;
  horizonSoftness: number;
  sunDiskIntensity: number;
  sunGlowIntensity: number;
  hazeIntensity: number;
  postProcessEnabled: boolean;
  postProcessOpacity: number;
  postProcessExposure: number;
  postProcessContrast: number;
  postProcessSaturation: number;
  postProcessVignette: number;
  postProcessDebugMode: PostProcessSettings["debugMode"];
  audioEnabled: boolean;
  audioVolume: number;
}

const ENVIRONMENT_ARCHIVE_KEYS = [
  "sunAzimuthDeg", "sunElevationDeg", "sunIntensity", "skyIntensity", "groundIntensity",
  "exposure", "horizonSoftness", "sunDiskIntensity", "sunGlowIntensity", "hazeIntensity",
  "postProcessEnabled", "postProcessOpacity", "postProcessExposure", "postProcessContrast",
  "postProcessSaturation", "postProcessVignette", "postProcessDebugMode",
] as const satisfies readonly (keyof ProjectSessionState)[];

export function createEnvironmentSliceState(input: {
  queryPerfMode: boolean;
  audioEnabled: boolean;
  audioVolume: number;
}): EnvironmentSliceState {
  return {
    sunAzimuthDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunAzimuthDeg,
    sunElevationDeg: DEFAULT_ENVIRONMENT_SETTINGS.sunElevationDeg,
    sunIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunIntensity,
    skyIntensity: DEFAULT_ENVIRONMENT_SETTINGS.skyIntensity,
    groundIntensity: DEFAULT_ENVIRONMENT_SETTINGS.groundIntensity,
    exposure: DEFAULT_ENVIRONMENT_SETTINGS.exposure,
    horizonSoftness: DEFAULT_ENVIRONMENT_SETTINGS.horizonSoftness,
    sunDiskIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunDiskIntensity,
    sunGlowIntensity: DEFAULT_ENVIRONMENT_SETTINGS.sunGlowIntensity,
    hazeIntensity: DEFAULT_ENVIRONMENT_SETTINGS.hazeIntensity,
    postProcessEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.enabled,
    postProcessOpacity: DEFAULT_POST_PROCESS_SETTINGS.opacity,
    postProcessExposure: DEFAULT_POST_PROCESS_SETTINGS.exposure,
    postProcessContrast: DEFAULT_POST_PROCESS_SETTINGS.contrast,
    postProcessSaturation: DEFAULT_POST_PROCESS_SETTINGS.saturation,
    postProcessVignette: DEFAULT_POST_PROCESS_SETTINGS.vignette,
    postProcessDebugMode: DEFAULT_POST_PROCESS_SETTINGS.debugMode,
    audioEnabled: input.audioEnabled,
    audioVolume: input.audioVolume,
  };
}

export function applyEnvironmentArchiveState(
  target: EnvironmentSliceState,
  archive: ProjectSessionState,
): void {
  assignArchiveFields(target, archive, ENVIRONMENT_ARCHIVE_KEYS);
}
