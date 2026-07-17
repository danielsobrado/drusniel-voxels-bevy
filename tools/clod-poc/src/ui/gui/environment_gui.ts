import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import {
  applyPostProcessQualityPreset,
  type PostProcessQualityPreset,
} from "../../app/state/postprocess_quality_presets.js";
import { setAudioEnabled, setMasterVolume } from "../../audio/index.js";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
} from "../../environment/environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../../environment/postprocess.js";
import type { PostFxFroxelDebugMode } from "../../gpu/postfx_atmosphere.js";
import { DEFAULT_TERRAIN_COLOR_ADJUSTMENTS } from "../../material/material.js";
import type { GuiController } from "./gui_controller.js";

export interface EnvironmentGuiDeps {
  updateLighting: () => void;
  applyColorAdjustmentsToTerrain: () => void;
  currentPostProcessSettings: () => PostProcessSettings;
  postProcess: { updateSettings: (settings: Partial<PostProcessSettings>) => void } | null;
  applyTreeQualityPreset?: (preset: Exclude<PostProcessQualityPreset, "custom">) => void;
}

interface WebGpuPostProcessStageMirror {
  cloudsEnabled?: boolean;
  gtaoEnabled?: boolean;
  froxelsEnabled?: boolean;
  bounceEnabled?: boolean;
}

export function createEnvironmentGui(
  gui: GUI,
  state: ClodAppState,
  deps: EnvironmentGuiDeps,
): void {
  const currentGuiPostProcessSettings = (): Partial<PostProcessSettings> => ({
    ...deps.currentPostProcessSettings(),
    renderScale: state.postProcessRenderScale,
    toneMapping: state.postProcessToneMapping,
    bloomEnabled: state.postProcessBloomEnabled,
    bloomThreshold: state.postProcessBloomThreshold,
    bloomStrength: state.postProcessBloomStrength,
    bloomRadius: state.postProcessBloomRadius,
    fxaaEnabled: state.postProcessFxaaEnabled,
    fxaaEdgeThreshold: state.postProcessFxaaEdgeThreshold,
    fxaaSubpixelBlend: state.postProcessFxaaSubpixelBlend,
    taaEnabled: state.postProcessTaaEnabled,
    taaHistoryWeight: state.postProcessTaaHistoryWeight,
    taaDepthThreshold: state.postProcessTaaDepthThreshold,
    taaSharpen: state.postProcessTaaSharpen,
    taaJitterEnabled: state.postProcessTaaJitterEnabled,
    taaJitterScale: state.postProcessTaaJitterScale,
    taaHistoryClampEnabled: state.postProcessTaaHistoryClampEnabled,
    taaHistoryClampStrength: state.postProcessTaaHistoryClampStrength,
    contactShadowsEnabled: state.postProcessContactShadowsEnabled,
    contactShadowsStrength: state.postProcessContactShadowsStrength,
    contactShadowsRadiusPx: state.postProcessContactShadowsRadiusPx,
    contactShadowsDepthBias: state.postProcessContactShadowsDepthBias,
    clarityEnabled: state.postProcessClarityEnabled,
    claritySharpen: state.postProcessClaritySharpen,
    clarityDither: state.postProcessClarityDither,
    aerialPerspectiveEnabled: state.postProcessAerialPerspectiveEnabled,
    aerialPerspectiveStart: state.postProcessAerialPerspectiveStart,
    aerialPerspectiveEnd: state.postProcessAerialPerspectiveEnd,
    aerialPerspectiveStrength: state.postProcessAerialPerspectiveStrength,
    aerialPerspectiveColor: [
      state.postProcessAerialPerspectiveColorR,
      state.postProcessAerialPerspectiveColorG,
      state.postProcessAerialPerspectiveColorB,
    ],
    cloudsEnabled: state.postProcessCloudsEnabled,
    gtaoEnabled: state.postProcessGtaoEnabled,
    froxelsEnabled: state.postProcessFroxelsEnabled,
    bounceEnabled: state.postProcessBounceEnabled,
    froxelDebugEnabled: state.froxelDebugEnabled,
    froxelDebugMode: state.froxelDebugMode,
    godRaysMode: state.godRaysMode,
    godRaysDensity: state.godRaysDensity,
    godRaysDecay: state.godRaysDecay,
    godRaysWeight: state.godRaysWeight,
    godRaysExposure: state.godRaysExposure,
    godRaysDustStrength: state.godRaysDustStrength,
    godRaysDustScale: state.godRaysDustScale,
    godRaysDustSpeed: state.godRaysDustSpeed,
  });
  const syncWebGpuStageMirror = (settings: Partial<PostProcessSettings>) => {
    const mirror = deps.postProcess as unknown as WebGpuPostProcessStageMirror | null;
    if (!mirror) return;
    mirror.cloudsEnabled = settings.cloudsEnabled;
    mirror.gtaoEnabled = settings.gtaoEnabled;
    mirror.froxelsEnabled = settings.froxelsEnabled;
    mirror.bounceEnabled = settings.bounceEnabled;
  };
  const applyPostProcessSettings = () => {
    const settings = currentGuiPostProcessSettings();
    syncWebGpuStageMirror(settings);
    deps.postProcess?.updateSettings(settings);
  };

  const audioFolder = gui.addFolder("Audio");
  audioFolder.add(state, "audioEnabled").name("Audio feedback").onChange((enabled: boolean) => {
    setAudioEnabled(enabled);
  });
  audioFolder.add(state, "audioVolume", 0, 1, 0.05).name("Master volume").onChange((volume: number) => {
    setMasterVolume(volume);
  });

  const environmentFolder = gui.addFolder("sky + environment");
  const environmentControllers: GuiController[] = [
    environmentFolder.add(state, "sunAzimuthDeg", 0, 360, 1).name("sun azimuth").onChange(deps.updateLighting),
    environmentFolder.add(state, "sunElevationDeg", 5, 85, 1).name("sun elevation").onChange(deps.updateLighting),
    environmentFolder.add(state, "sunIntensity", 0, 2.5, 0.05).name("sun intensity").onChange(deps.updateLighting),
    environmentFolder.add(state, "skyIntensity", 0, 2, 0.05).name("sky fill").onChange(deps.updateLighting),
    environmentFolder.add(state, "groundIntensity", 0, 2, 0.05).name("ground fill").onChange(deps.updateLighting),
    environmentFolder.add(state, "exposure", 0.4, 2, 0.05).name("exposure").onChange(deps.updateLighting),
    environmentFolder.add(state, "horizonSoftness", 0.2, 2.5, 0.01).name("horizon softness").onChange(deps.updateLighting),
    environmentFolder.add(state, "sunDiskIntensity", 0, 4, 0.05).name("sun disk").onChange(deps.updateLighting),
    environmentFolder.add(state, "sunGlowIntensity", 0, 4, 0.05).name("sun glow").onChange(deps.updateLighting),
    environmentFolder.add(state, "hazeIntensity", 0, 1.5, 0.01).name("sky haze").onChange(deps.updateLighting),
  ];
  const environmentActions = {
    reset: () => {
      Object.assign(state, DEFAULT_ENVIRONMENT_SETTINGS);
      deps.updateLighting();
      for (const controller of environmentControllers) controller.updateDisplay();
    },
  };
  environmentFolder.add(environmentActions, "reset").name("reset");

  const colorFolder = gui.addFolder("terrain color");
  const colorControllers: GuiController[] = [
    colorFolder.add(state, "terrainBrightness", 0.2, 2.5, 0.01).name("brightness").onChange(deps.applyColorAdjustmentsToTerrain),
    colorFolder.add(state, "terrainContrast", 0.2, 2.5, 0.01).name("contrast").onChange(deps.applyColorAdjustmentsToTerrain),
    colorFolder.add(state, "terrainSaturation", 0.0, 2.5, 0.01).name("saturation").onChange(deps.applyColorAdjustmentsToTerrain),
    colorFolder.add(state, "terrainWarmth", -1.0, 1.0, 0.01).name("warmth").onChange(deps.applyColorAdjustmentsToTerrain),
  ];
  const colorActions = {
    reset: () => {
      state.terrainBrightness = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.brightness;
      state.terrainContrast = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.contrast;
      state.terrainSaturation = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.saturation;
      state.terrainWarmth = DEFAULT_TERRAIN_COLOR_ADJUSTMENTS.warmth;
      deps.applyColorAdjustmentsToTerrain();
      for (const controller of colorControllers) controller.updateDisplay();
    },
  };
  colorFolder.add(colorActions, "reset").name("reset");

  const postFolder = gui.addFolder("postprocess");
  const postControllers: GuiController[] = [
    postFolder.add(state, "postProcessEnabled").name("enabled").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessDebugMode", ["output", "copy", "off"]).name("mode").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessRenderScale", 0.5, 1, 0.05).name("render scale").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessToneMapping", ["aces", "agx", "linear", "none"]).name("tone map").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessOpacity", 0, 1, 0.01).name("copy opacity").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessExposure", 0.25, 2.5, 0.01).name("pass exposure").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContrast", 0.25, 2.5, 0.01).name("contrast").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessSaturation", 0, 2.5, 0.01).name("saturation").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessVignette", 0, 1.5, 0.01).name("vignette").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomEnabled").name("bloom").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomThreshold", 0, 2, 0.01).name("bloom threshold").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomStrength", 0, 1.5, 0.01).name("bloom strength").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomRadius", 0, 2, 0.01).name("bloom radius").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessFxaaEnabled").name("FXAA-lite (WebGL)").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessFxaaEdgeThreshold", 0.03, 0.33, 0.005).name("FXAA edge threshold").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessFxaaSubpixelBlend", 0, 1, 0.01).name("FXAA subpixel").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessClarityEnabled").name("clarity (WebGL)").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessClaritySharpen", 0, 0.5, 0.01).name("clarity sharpen").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessClarityDither", 0, 0.02, 0.0005).name("clarity dither").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaEnabled").name("TRAA").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaHistoryWeight", 0, 0.97, 0.01).name("TAA history").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaDepthThreshold", 0, 0.05, 0.0005).name("TAA depth reject").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaSharpen", 0, 0.5, 0.01).name("TAA sharpen").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaJitterEnabled").name("TAA jitter").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaJitterScale", 0, 2, 0.05).name("TAA jitter scale").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaHistoryClampEnabled").name("TAA history clamp").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaHistoryClampStrength", 0, 1, 0.01).name("TAA clamp strength").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveEnabled").name("aerial haze").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveStart", 0, 4000, 10).name("aerial start m").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveEnd", 1, 8000, 10).name("aerial end m").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveStrength", 0, 1, 0.01).name("aerial strength").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessCloudsEnabled").name("volumetric clouds").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsEnabled").name("contact shadows").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsStrength", 0, 1, 0.01).name("contact strength").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsRadiusPx", 0.5, 8, 0.25).name("contact radius px").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsDepthBias", 0, 0.05, 0.0005).name("contact depth bias").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessGtaoEnabled").name("GTAO").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessFroxelsEnabled").name("froxels").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBounceEnabled").name("screen bounce").onChange(applyPostProcessSettings),
  ];
  const refreshPostControllers = () => {
    for (const controller of postControllers) controller.updateDisplay();
  };
  const applyPreset = (preset: Exclude<PostProcessQualityPreset, "custom">) => {
    applyPostProcessQualityPreset(state, preset);
    applyPostProcessSettings();
    deps.applyTreeQualityPreset?.(preset);
    refreshPostControllers();
  };
  const presetActions = {
    ultra: () => applyPreset("ultra"),
    balanced: () => applyPreset("balanced"),
    perf: () => applyPreset("perf"),
    potato: () => applyPreset("potato"),
  };
  postFolder.add(presetActions, "ultra").name("preset: ultra");
  postFolder.add(presetActions, "balanced").name("preset: balanced");
  postFolder.add(presetActions, "perf").name("preset: perf");
  postFolder.add(presetActions, "potato").name("preset: potato");

  const postActions = {
    reset: () => {
      const aerialColor = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveColor;
      state.postProcessQualityPreset = "custom";
      state.postProcessEnabled = DEFAULT_POST_PROCESS_SETTINGS.enabled;
      state.postProcessOpacity = DEFAULT_POST_PROCESS_SETTINGS.opacity;
      state.postProcessRenderScale = DEFAULT_POST_PROCESS_SETTINGS.renderScale;
      state.postProcessExposure = DEFAULT_POST_PROCESS_SETTINGS.exposure;
      state.postProcessContrast = DEFAULT_POST_PROCESS_SETTINGS.contrast;
      state.postProcessSaturation = DEFAULT_POST_PROCESS_SETTINGS.saturation;
      state.postProcessVignette = DEFAULT_POST_PROCESS_SETTINGS.vignette;
      state.postProcessDebugMode = DEFAULT_POST_PROCESS_SETTINGS.debugMode;
      state.postProcessToneMapping = DEFAULT_POST_PROCESS_SETTINGS.toneMapping;
      state.postProcessBloomEnabled = DEFAULT_POST_PROCESS_SETTINGS.bloomEnabled;
      state.postProcessBloomThreshold = DEFAULT_POST_PROCESS_SETTINGS.bloomThreshold;
      state.postProcessBloomStrength = DEFAULT_POST_PROCESS_SETTINGS.bloomStrength;
      state.postProcessBloomRadius = DEFAULT_POST_PROCESS_SETTINGS.bloomRadius;
      state.postProcessFxaaEnabled = DEFAULT_POST_PROCESS_SETTINGS.fxaaEnabled;
      state.postProcessFxaaEdgeThreshold = DEFAULT_POST_PROCESS_SETTINGS.fxaaEdgeThreshold;
      state.postProcessFxaaSubpixelBlend = DEFAULT_POST_PROCESS_SETTINGS.fxaaSubpixelBlend;
      state.postProcessClarityEnabled = DEFAULT_POST_PROCESS_SETTINGS.clarityEnabled;
      state.postProcessClaritySharpen = DEFAULT_POST_PROCESS_SETTINGS.claritySharpen;
      state.postProcessClarityDither = DEFAULT_POST_PROCESS_SETTINGS.clarityDither;
      state.postProcessTaaEnabled = DEFAULT_POST_PROCESS_SETTINGS.taaEnabled;
      state.postProcessTaaHistoryWeight = DEFAULT_POST_PROCESS_SETTINGS.taaHistoryWeight;
      state.postProcessTaaDepthThreshold = DEFAULT_POST_PROCESS_SETTINGS.taaDepthThreshold;
      state.postProcessTaaSharpen = DEFAULT_POST_PROCESS_SETTINGS.taaSharpen;
      state.postProcessTaaJitterEnabled = DEFAULT_POST_PROCESS_SETTINGS.taaJitterEnabled;
      state.postProcessTaaJitterScale = DEFAULT_POST_PROCESS_SETTINGS.taaJitterScale;
      state.postProcessTaaHistoryClampEnabled = DEFAULT_POST_PROCESS_SETTINGS.taaHistoryClampEnabled;
      state.postProcessTaaHistoryClampStrength = DEFAULT_POST_PROCESS_SETTINGS.taaHistoryClampStrength;
      state.postProcessContactShadowsEnabled = DEFAULT_POST_PROCESS_SETTINGS.contactShadowsEnabled;
      state.postProcessContactShadowsStrength = DEFAULT_POST_PROCESS_SETTINGS.contactShadowsStrength;
      state.postProcessContactShadowsRadiusPx = DEFAULT_POST_PROCESS_SETTINGS.contactShadowsRadiusPx;
      state.postProcessContactShadowsDepthBias = DEFAULT_POST_PROCESS_SETTINGS.contactShadowsDepthBias;
      state.postProcessAerialPerspectiveEnabled = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveEnabled;
      state.postProcessAerialPerspectiveStart = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveStart;
      state.postProcessAerialPerspectiveEnd = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveEnd;
      state.postProcessAerialPerspectiveStrength = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveStrength;
      state.postProcessAerialPerspectiveColorR = aerialColor[0];
      state.postProcessAerialPerspectiveColorG = aerialColor[1];
      state.postProcessAerialPerspectiveColorB = aerialColor[2];
      state.postProcessCloudsEnabled = DEFAULT_POST_PROCESS_SETTINGS.cloudsEnabled;
      state.postProcessGtaoEnabled = DEFAULT_POST_PROCESS_SETTINGS.gtaoEnabled;
      state.postProcessFroxelsEnabled = DEFAULT_POST_PROCESS_SETTINGS.froxelsEnabled;
      state.postProcessBounceEnabled = DEFAULT_POST_PROCESS_SETTINGS.bounceEnabled;
      applyPostProcessSettings();
      refreshPostControllers();
    },
  };
  postFolder.add(postActions, "reset").name("reset");

  const godRaysFolder = gui.addFolder("god rays");
  const godRaysControllers: GuiController[] = [
    godRaysFolder.add(state, "godRaysMode", ["off", "cheap", "heavy", "volumetric"]).name("mode").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDensity", 0, 2, 0.01).name("density").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDecay", 0, 1, 0.01).name("decay").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysWeight", 0, 1, 0.01).name("weight").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysExposure", 0, 1, 0.01).name("exposure").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDustStrength", 0, 1, 0.01).name("dust strength").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDustScale", 1, 24, 0.1).name("dust scale").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDustSpeed", 0, 0.5, 0.005).name("dust speed").onChange(applyPostProcessSettings),
  ];
  const godRaysActions = {
    reset: () => {
      state.godRaysMode = DEFAULT_POST_PROCESS_SETTINGS.godRaysMode;
      state.godRaysDensity = DEFAULT_POST_PROCESS_SETTINGS.godRaysDensity;
      state.godRaysDecay = DEFAULT_POST_PROCESS_SETTINGS.godRaysDecay;
      state.godRaysWeight = DEFAULT_POST_PROCESS_SETTINGS.godRaysWeight;
      state.godRaysExposure = DEFAULT_POST_PROCESS_SETTINGS.godRaysExposure;
      state.godRaysDustStrength = DEFAULT_POST_PROCESS_SETTINGS.godRaysDustStrength;
      state.godRaysDustScale = DEFAULT_POST_PROCESS_SETTINGS.godRaysDustScale;
      state.godRaysDustSpeed = DEFAULT_POST_PROCESS_SETTINGS.godRaysDustSpeed;
      applyPostProcessSettings();
      for (const controller of godRaysControllers) controller.updateDisplay();
    },
  };
  godRaysFolder.add(godRaysActions, "reset").name("reset");

  const froxelDebugFolder = gui.addFolder("froxel debug");
  const froxelDebugControllers: GuiController[] = [
    froxelDebugFolder.add(state, "froxelDebugEnabled").name("enabled").onChange(applyPostProcessSettings),
    froxelDebugFolder
      .add(state, "froxelDebugMode", ["off", "density", "transmittance", "scatter"])
      .name("mode")
      .onChange((mode: PostFxFroxelDebugMode) => {
        // Picking a buffer implies the overlay is on; picking `off` turns it back off.
        state.froxelDebugEnabled = mode !== "off";
        applyPostProcessSettings();
        for (const controller of froxelDebugControllers) controller.updateDisplay();
      }),
  ];
  const froxelDebugActions = {
    reset: () => {
      state.froxelDebugEnabled = DEFAULT_POST_PROCESS_SETTINGS.froxelDebugEnabled;
      state.froxelDebugMode = DEFAULT_POST_PROCESS_SETTINGS.froxelDebugMode;
      applyPostProcessSettings();
      for (const controller of froxelDebugControllers) controller.updateDisplay();
    },
  };
  froxelDebugFolder.add(froxelDebugActions, "reset").name("reset");
}
