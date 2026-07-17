import type { ProjectSessionState } from "../../project/voxel_project_archive.js";
import { DEFAULT_ENVIRONMENT_SETTINGS } from "../../environment/environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type GodRaysMode,
  type PostProcessSettings,
} from "../../environment/postprocess.js";
import type { PostFxFroxelDebugMode } from "../../gpu/postfx_atmosphere.js";
import { assignArchiveFields } from "./archive_fields.js";
import type { PostProcessQualityPreset } from "./postprocess_quality_presets.js";

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
  postProcessQualityPreset: PostProcessQualityPreset;
  postProcessOpacity: number;
  postProcessRenderScale: number;
  postProcessExposure: number;
  postProcessContrast: number;
  postProcessSaturation: number;
  postProcessVignette: number;
  postProcessDebugMode: PostProcessSettings["debugMode"];
  postProcessToneMapping: PostProcessSettings["toneMapping"];
  postProcessBloomEnabled: boolean;
  postProcessBloomThreshold: number;
  postProcessBloomStrength: number;
  postProcessBloomRadius: number;
  postProcessFxaaEnabled: boolean;
  postProcessFxaaEdgeThreshold: number;
  postProcessFxaaSubpixelBlend: number;
  postProcessTaaEnabled: boolean;
  postProcessTaaHistoryWeight: number;
  postProcessTaaDepthThreshold: number;
  postProcessTaaSharpen: number;
  postProcessTaaJitterEnabled: boolean;
  postProcessTaaJitterScale: number;
  postProcessTaaHistoryClampEnabled: boolean;
  postProcessTaaHistoryClampStrength: number;
  postProcessContactShadowsEnabled: boolean;
  postProcessContactShadowsStrength: number;
  postProcessContactShadowsRadiusPx: number;
  postProcessContactShadowsDepthBias: number;
  postProcessClarityEnabled: boolean;
  postProcessClaritySharpen: number;
  postProcessClarityDither: number;
  postProcessAerialPerspectiveEnabled: boolean;
  postProcessAerialPerspectiveStart: number;
  postProcessAerialPerspectiveEnd: number;
  postProcessAerialPerspectiveStrength: number;
  postProcessAerialPerspectiveColorR: number;
  postProcessAerialPerspectiveColorG: number;
  postProcessAerialPerspectiveColorB: number;
  postProcessCloudsEnabled: boolean;
  postProcessGtaoEnabled: boolean;
  postProcessFroxelsEnabled: boolean;
  postProcessBounceEnabled: boolean;
  froxelDebugEnabled: boolean;
  froxelDebugMode: PostFxFroxelDebugMode;
  godRaysMode: GodRaysMode;
  godRaysDensity: number;
  godRaysDecay: number;
  godRaysWeight: number;
  godRaysExposure: number;
  godRaysDustStrength: number;
  godRaysDustScale: number;
  godRaysDustSpeed: number;
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
  const aerialColor = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveColor;
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
    postProcessQualityPreset: "custom",
    postProcessOpacity: DEFAULT_POST_PROCESS_SETTINGS.opacity,
    postProcessRenderScale: DEFAULT_POST_PROCESS_SETTINGS.renderScale,
    postProcessExposure: DEFAULT_POST_PROCESS_SETTINGS.exposure,
    postProcessContrast: DEFAULT_POST_PROCESS_SETTINGS.contrast,
    postProcessSaturation: DEFAULT_POST_PROCESS_SETTINGS.saturation,
    postProcessVignette: DEFAULT_POST_PROCESS_SETTINGS.vignette,
    postProcessDebugMode: DEFAULT_POST_PROCESS_SETTINGS.debugMode,
    postProcessToneMapping: DEFAULT_POST_PROCESS_SETTINGS.toneMapping,
    postProcessBloomEnabled: DEFAULT_POST_PROCESS_SETTINGS.bloomEnabled,
    postProcessBloomThreshold: DEFAULT_POST_PROCESS_SETTINGS.bloomThreshold,
    postProcessBloomStrength: DEFAULT_POST_PROCESS_SETTINGS.bloomStrength,
    postProcessBloomRadius: DEFAULT_POST_PROCESS_SETTINGS.bloomRadius,
    postProcessFxaaEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.fxaaEnabled,
    postProcessFxaaEdgeThreshold: DEFAULT_POST_PROCESS_SETTINGS.fxaaEdgeThreshold,
    postProcessFxaaSubpixelBlend: DEFAULT_POST_PROCESS_SETTINGS.fxaaSubpixelBlend,
    postProcessTaaEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.taaEnabled,
    postProcessTaaHistoryWeight: DEFAULT_POST_PROCESS_SETTINGS.taaHistoryWeight,
    postProcessTaaDepthThreshold: DEFAULT_POST_PROCESS_SETTINGS.taaDepthThreshold,
    postProcessTaaSharpen: DEFAULT_POST_PROCESS_SETTINGS.taaSharpen,
    postProcessTaaJitterEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.taaJitterEnabled,
    postProcessTaaJitterScale: DEFAULT_POST_PROCESS_SETTINGS.taaJitterScale,
    postProcessTaaHistoryClampEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.taaHistoryClampEnabled,
    postProcessTaaHistoryClampStrength: DEFAULT_POST_PROCESS_SETTINGS.taaHistoryClampStrength,
    postProcessContactShadowsEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.contactShadowsEnabled,
    postProcessContactShadowsStrength: DEFAULT_POST_PROCESS_SETTINGS.contactShadowsStrength,
    postProcessContactShadowsRadiusPx: DEFAULT_POST_PROCESS_SETTINGS.contactShadowsRadiusPx,
    postProcessContactShadowsDepthBias: DEFAULT_POST_PROCESS_SETTINGS.contactShadowsDepthBias,
    postProcessClarityEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.clarityEnabled,
    postProcessClaritySharpen: DEFAULT_POST_PROCESS_SETTINGS.claritySharpen,
    postProcessClarityDither: DEFAULT_POST_PROCESS_SETTINGS.clarityDither,
    postProcessAerialPerspectiveEnabled: DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveEnabled,
    postProcessAerialPerspectiveStart: DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveStart,
    postProcessAerialPerspectiveEnd: DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveEnd,
    postProcessAerialPerspectiveStrength: DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveStrength,
    postProcessAerialPerspectiveColorR: aerialColor[0],
    postProcessAerialPerspectiveColorG: aerialColor[1],
    postProcessAerialPerspectiveColorB: aerialColor[2],
    postProcessCloudsEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.cloudsEnabled,
    postProcessGtaoEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.gtaoEnabled,
    postProcessFroxelsEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.froxelsEnabled,
    postProcessBounceEnabled: input.queryPerfMode ? false : DEFAULT_POST_PROCESS_SETTINGS.bounceEnabled,
    froxelDebugEnabled: DEFAULT_POST_PROCESS_SETTINGS.froxelDebugEnabled,
    froxelDebugMode: DEFAULT_POST_PROCESS_SETTINGS.froxelDebugMode,
    godRaysMode: DEFAULT_POST_PROCESS_SETTINGS.godRaysMode,
    godRaysDensity: DEFAULT_POST_PROCESS_SETTINGS.godRaysDensity,
    godRaysDecay: DEFAULT_POST_PROCESS_SETTINGS.godRaysDecay,
    godRaysWeight: DEFAULT_POST_PROCESS_SETTINGS.godRaysWeight,
    godRaysExposure: DEFAULT_POST_PROCESS_SETTINGS.godRaysExposure,
    godRaysDustStrength: DEFAULT_POST_PROCESS_SETTINGS.godRaysDustStrength,
    godRaysDustScale: DEFAULT_POST_PROCESS_SETTINGS.godRaysDustScale,
    godRaysDustSpeed: DEFAULT_POST_PROCESS_SETTINGS.godRaysDustSpeed,
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
