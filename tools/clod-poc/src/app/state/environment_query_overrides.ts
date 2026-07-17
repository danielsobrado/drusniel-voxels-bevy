import { parseGodRaysModeParam, type PostProcessToneMapping } from "../../environment/postprocess.js";
import { parsePostFxFroxelDebugMode } from "../../gpu/postfx_atmosphere.js";
import type { ClodAppState } from "./index.js";
import {
  applyPostProcessQualityPreset,
  isPostProcessQualityPreset,
} from "./postprocess_quality_presets.js";
import {
  applyTreeQualityPreset,
  isTreeShadowMaxLod,
} from "./tree_quality_presets.js";

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

function qualityPresetParam(searchParams: URLSearchParams): string | null {
  return searchParams.get("quality") ?? searchParams.get("qualityPreset") ?? searchParams.get("preset");
}

function treeShadowMaxLodParam(searchParams: URLSearchParams): string | null {
  return searchParams.get("treeShadowMaxLod") ?? searchParams.get("treeShadowLod") ?? searchParams.get("treeShadows");
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

function enableStrictTreeGpuMode(state: ClodAppState): void {
  state.treeGpuEnabled = true;
  state.treeGpuFallbackToCpu = false;
  state.treeGpuForceCpu = false;
}

export function applyEnvironmentQueryOverrides(state: ClodAppState, searchParams: URLSearchParams): void {
  apply(searchParams, ["sunElevationDeg", "sunElevation"], (value) => {
    state.sunElevationDeg = clamp(value, -10, 90);
  });
  apply(searchParams, ["sunAzimuthDeg", "sunAzimuth"], (value) => {
    state.sunAzimuthDeg = ((value % 360) + 360) % 360;
  });
  apply(searchParams, ["sunIntensity"], (value) => { state.sunIntensity = Math.max(0, value); });
  apply(searchParams, ["skyIntensity"], (value) => { state.skyIntensity = Math.max(0, value); });
  apply(searchParams, ["groundIntensity"], (value) => { state.groundIntensity = Math.max(0, value); });
  apply(searchParams, ["exposure"], (value) => { state.exposure = Math.max(0, value); });
  apply(searchParams, ["hazeIntensity"], (value) => { state.hazeIntensity = Math.max(0, value); });

  const timings = flagParam(searchParams, "timings", "profile");
  if (timings !== null) state.profileEnabled = timings;

  const qualityPreset = qualityPresetParam(searchParams);
  if (isPostProcessQualityPreset(qualityPreset)) {
    applyPostProcessQualityPreset(state, qualityPreset);
    applyTreeQualityPreset(state, qualityPreset);
  }

  apply(searchParams, ["renderScale", "renderscale", "postScale", "postprocessScale"], (value) => {
    state.postProcessRenderScale = clamp(value, 0.5, 1);
  });
  apply(searchParams, ["treeDistance", "treeDistanceM", "treeRing", "treeRingM"], (value) => { state.treeDistance = Math.max(0, value); });
  apply(searchParams, ["treeMaxInstances", "treeMax"], (value) => { state.treeMaxInstances = Math.floor(Math.max(0, value)); });
  apply(searchParams, ["treeDensity", "treeBaseDensity"], (value) => { state.treeDensity = Math.max(0, value); });
  apply(searchParams, ["treeSpacing", "treeSpacingM"], (value) => { state.treeSpacing = Math.max(0.5, value); });
  apply(searchParams, ["treeGpuMaxVisible", "treeGpuMax"], (value) => { state.treeGpuMaxVisible = Math.floor(Math.max(0, value)); });

  const treeShadowMaxLod = treeShadowMaxLodParam(searchParams);
  if (isTreeShadowMaxLod(treeShadowMaxLod)) state.treeShadowMaxLod = treeShadowMaxLod;

  const treeFarCheapMaterial = flagParam(searchParams, "treeFarCheapMaterial", "treeCheapFarMaterial", "treeFarCheap");
  if (treeFarCheapMaterial !== null) state.treeFarCheapMaterial = treeFarCheapMaterial;

  const treePlacementDebug = flagParam(searchParams, "treePlacementDebug", "treeDebugPlacement", "treePlacementOverlay");
  if (treePlacementDebug !== null) state.treePlacementDebug = treePlacementDebug;

  const treeImpostorSwapOnBake = flagParam(searchParams, "treeImpostorSwapOnBake", "treeImpostorHotSwap", "treeSwapImpostors");
  if (treeImpostorSwapOnBake !== null) state.treeImpostorSwapOnBake = treeImpostorSwapOnBake;

  const treeGpu = flagParam(searchParams, "treeGpu", "treeGPU", "gpuTrees");
  if (treeGpu !== null) state.treeGpuEnabled = treeGpu;

  const treeGpuFallback = flagParam(searchParams, "treeGpuFallback", "treeGpuFallbackToCpu", "treeGpuCpuFallback");
  if (treeGpuFallback !== null) state.treeGpuFallbackToCpu = treeGpuFallback;

  const treeGpuForceCpu = flagParam(searchParams, "treeGpuForceCpu", "treeForceCpu", "treeCpu");
  if (treeGpuForceCpu !== null) state.treeGpuForceCpu = treeGpuForceCpu;

  const treeGpuStrict = flagParam(searchParams, "treeGpuStrict", "treeGpuNoFallback", "treeGpuFailLoud");
  if (treeGpuStrict === true) enableStrictTreeGpuMode(state);

  const treeWind = flagParam(searchParams, "treeWind");
  if (treeWind !== null) {
    state.treeWindEnabled = treeWind;
    if (!treeWind) {
      state.treeWindStrength = 0;
      state.treeGustStrength = 0;
      state.treeTrunkSwayStrength = 0;
      state.treeLeafFlutterStrength = 0;
    }
  }
  const grassWind = flagParam(searchParams, "grassWind");
  if (grassWind === false) {
    state.grassWindStrength = 0;
    state.grassWindSpeed = 0;
  }

  const treeGpuCounts = flagParam(searchParams, "treeGpuCounts", "treeCounts");
  if (treeGpuCounts !== null) {
    state.treeGpuShowCounts = treeGpuCounts;
    if (treeGpuCounts) state.treeGpuReadbackVisibleLists = true;
  }

  const treeGpuReadback = flagParam(searchParams, "treeGpuReadback", "treeReadback", "treeGpuReadbackVisibleLists");
  if (treeGpuReadback !== null) state.treeGpuReadbackVisibleLists = treeGpuReadback;

  const treeGpuValidate = flagParam(searchParams, "treeGpuValidate", "treeValidate", "treeGpuValidation");
  if (treeGpuValidate !== null) {
    state.treeGpuValidateAgainstCpu = treeGpuValidate;
    if (treeGpuValidate) state.treeGpuReadbackVisibleLists = true;
  }

  const fx = flagParam(searchParams, "fx");
  if (fx === false) {
    state.postProcessEnabled = false;
    state.postProcessDebugMode = "off";
    state.postProcessBloomEnabled = false;
    state.postProcessFxaaEnabled = false;
    state.postProcessTaaEnabled = false;
    state.postProcessTaaJitterEnabled = false;
    state.postProcessTaaHistoryClampEnabled = false;
    state.postProcessContactShadowsEnabled = false;
    state.postProcessClarityEnabled = false;
    state.postProcessAerialPerspectiveEnabled = false;
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
    state.postProcessFxaaEnabled = false;
    state.postProcessTaaEnabled = false;
    state.postProcessTaaJitterEnabled = false;
    state.postProcessTaaHistoryClampEnabled = false;
    state.postProcessContactShadowsEnabled = false;
    state.postProcessClarityEnabled = false;
    state.postProcessAerialPerspectiveEnabled = false;
    state.godRaysMode = "off";
  }

  const grade = flagParam(searchParams, "grade");
  if (grade === false) neutralGrade(state);
  const bloom = flagParam(searchParams, "bloom");
  if (bloom !== null) state.postProcessBloomEnabled = bloom;
  const fxaa = flagParam(searchParams, "fxaa", "aa");
  if (fxaa !== null) state.postProcessFxaaEnabled = fxaa;
  const taa = flagParam(searchParams, "taa");
  if (taa !== null) state.postProcessTaaEnabled = taa;
  const taaJitter = flagParam(searchParams, "taaJitter", "taajitter", "jitter");
  if (taaJitter !== null) state.postProcessTaaJitterEnabled = taaJitter;
  const taaClamp = flagParam(searchParams, "taaClamp", "taaclamp", "historyClamp");
  if (taaClamp !== null) state.postProcessTaaHistoryClampEnabled = taaClamp;
  const contactShadows = flagParam(searchParams, "contactShadows", "contactshadows", "contact");
  if (contactShadows !== null) state.postProcessContactShadowsEnabled = contactShadows;
  const clarity = flagParam(searchParams, "clarity", "sharpen");
  if (clarity !== null) state.postProcessClarityEnabled = clarity;
  const aerial = flagParam(searchParams, "aerial", "aerialPerspective");
  if (aerial !== null) state.postProcessAerialPerspectiveEnabled = aerial;
  const clouds = flagParam(searchParams, "clouds");
  if (clouds !== null) state.postProcessCloudsEnabled = clouds;
  const froxels = flagParam(searchParams, "froxels", "volumetrics");
  if (froxels !== null) state.postProcessFroxelsEnabled = froxels;
  const fog = flagParam(searchParams, "fog", "haze");
  if (fog === false) {
    state.hazeIntensity = 0;
    state.postProcessAerialPerspectiveEnabled = false;
    state.godRaysMode = "off";
  }
  const godRaysRaw = searchParams.get("godRays") ?? searchParams.get("godrays");
  if (godRaysRaw !== null) {
    const mode = parseGodRaysModeParam(godRaysRaw, state.godRaysMode === "off" ? "cheap" : state.godRaysMode);
    if (mode !== null) state.godRaysMode = mode;
  }
  apply(searchParams, ["godRaysDust", "godraysdust", "godRaysDustStrength", "godraysduststrength"], (value) => {
    state.godRaysDustStrength = clamp(value, 0, 1);
  });
  apply(searchParams, ["godRaysDustScale", "godraysdustscale"], (value) => {
    state.godRaysDustScale = clamp(value, 1, 24);
  });
  apply(searchParams, ["godRaysDustSpeed", "godraysdustspeed"], (value) => {
    state.godRaysDustSpeed = clamp(value, 0, 0.5);
  });
  const froxelDebug = searchParams.get("froxelDebug")
    ?? searchParams.get("froxelsDebug")
    ?? searchParams.get("volumetricDebug")
    ?? searchParams.get("volumetricsDebug");
  if (froxelDebug !== null) {
    // A named mode implies the overlay is on; `off` turns it back off.
    const mode = parsePostFxFroxelDebugMode(froxelDebug);
    state.froxelDebugMode = mode;
    state.froxelDebugEnabled = mode !== "off";
  }
  const toneMap = toneMappingParam(searchParams);
  if (toneMap !== null) state.postProcessToneMapping = toneMap;
}
