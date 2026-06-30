import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { setAudioEnabled, setMasterVolume } from "../../audio/index.js";
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
} from "../../environment/environment.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../../environment/postprocess.js";
import { DEFAULT_TERRAIN_COLOR_ADJUSTMENTS } from "../../material/material.js";
import type { GuiController } from "./gui_controller.js";

export interface EnvironmentGuiDeps {
  updateLighting: () => void;
  applyColorAdjustmentsToTerrain: () => void;
  currentPostProcessSettings: () => PostProcessSettings;
  postProcess: { updateSettings: (settings: Partial<PostProcessSettings>) => void } | null;
}

export function createEnvironmentGui(
  gui: GUI,
  state: ClodAppState,
  deps: EnvironmentGuiDeps,
): void {
  const currentGuiPostProcessSettings = (): Partial<PostProcessSettings> => ({
    ...deps.currentPostProcessSettings(),
    toneMapping: state.postProcessToneMapping,
    bloomEnabled: state.postProcessBloomEnabled,
    bloomThreshold: state.postProcessBloomThreshold,
    bloomStrength: state.postProcessBloomStrength,
    bloomRadius: state.postProcessBloomRadius,
    taaEnabled: state.postProcessTaaEnabled,
    taaHistoryWeight: state.postProcessTaaHistoryWeight,
    taaDepthThreshold: state.postProcessTaaDepthThreshold,
    taaSharpen: state.postProcessTaaSharpen,
    contactShadowsEnabled: state.postProcessContactShadowsEnabled,
    contactShadowsStrength: state.postProcessContactShadowsStrength,
    contactShadowsRadiusPx: state.postProcessContactShadowsRadiusPx,
    contactShadowsDepthBias: state.postProcessContactShadowsDepthBias,
    aerialPerspectiveEnabled: state.postProcessAerialPerspectiveEnabled,
    aerialPerspectiveStart: state.postProcessAerialPerspectiveStart,
    aerialPerspectiveEnd: state.postProcessAerialPerspectiveEnd,
    aerialPerspectiveStrength: state.postProcessAerialPerspectiveStrength,
    aerialPerspectiveColor: [
      state.postProcessAerialPerspectiveColorR,
      state.postProcessAerialPerspectiveColorG,
      state.postProcessAerialPerspectiveColorB,
    ],
  });
  const applyPostProcessSettings = () => {
    deps.postProcess?.updateSettings(currentGuiPostProcessSettings());
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
    postFolder.add(state, "postProcessToneMapping", ["aces", "agx", "linear", "none"]).name("tone map").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessOpacity", 0, 1, 0.01).name("copy opacity").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessExposure", 0.25, 2.5, 0.01).name("pass exposure").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContrast", 0.25, 2.5, 0.01).name("contrast").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessSaturation", 0, 2.5, 0.01).name("saturation").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessVignette", 0, 1.5, 0.01).name("vignette").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomEnabled").name("bloom (WebGL)").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomThreshold", 0, 2, 0.01).name("bloom threshold").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomStrength", 0, 1.5, 0.01).name("bloom strength").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessBloomRadius", 0, 2, 0.01).name("bloom radius").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaEnabled").name("TAA-lite (WebGL)").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaHistoryWeight", 0, 0.97, 0.01).name("TAA history").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaDepthThreshold", 0, 0.05, 0.0005).name("TAA depth reject").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessTaaSharpen", 0, 0.5, 0.01).name("TAA sharpen").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsEnabled").name("contact shadows (WebGL)").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsStrength", 0, 1, 0.01).name("contact strength").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsRadiusPx", 0.5, 8, 0.25).name("contact radius px").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessContactShadowsDepthBias", 0, 0.05, 0.0005).name("contact depth bias").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveEnabled").name("aerial haze (WebGL)").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveStart", 0, 4000, 10).name("aerial start m").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveEnd", 1, 8000, 10).name("aerial end m").onChange(applyPostProcessSettings),
    postFolder.add(state, "postProcessAerialPerspectiveStrength", 0, 1, 0.01).name("aerial strength").onChange(applyPostProcessSettings),
  ];
  const postActions = {
    reset: () => {
      const aerialColor = DEFAULT_POST_PROCESS_SETTINGS.aerialPerspectiveColor;
      state.postProcessEnabled = DEFAULT_POST_PROCESS_SETTINGS.enabled;
      state.postProcessOpacity = DEFAULT_POST_PROCESS_SETTINGS.opacity;
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
      state.postProcessTaaEnabled = DEFAULT_POST_PROCESS_SETTINGS.taaEnabled;
      state.postProcessTaaHistoryWeight = DEFAULT_POST_PROCESS_SETTINGS.taaHistoryWeight;
      state.postProcessTaaDepthThreshold = DEFAULT_POST_PROCESS_SETTINGS.taaDepthThreshold;
      state.postProcessTaaSharpen = DEFAULT_POST_PROCESS_SETTINGS.taaSharpen;
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
      applyPostProcessSettings();
      for (const controller of postControllers) controller.updateDisplay();
    },
  };
  postFolder.add(postActions, "reset").name("reset");

  const godRaysFolder = gui.addFolder("god rays");
  const godRaysControllers: GuiController[] = [
    godRaysFolder
      .add(state, "godRaysMode", ["off", "cheap", "heavy", "volumetric"])
      .name("mode (WebGPU)")
      .onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDensity", 0.5, 1.5, 0.01).name("density").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysDecay", 0.8, 0.99, 0.005).name("decay").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysWeight", 0.0, 1.0, 0.01).name("weight").onChange(applyPostProcessSettings),
    godRaysFolder.add(state, "godRaysExposure", 0.0, 2.0, 0.01).name("exposure").onChange(applyPostProcessSettings),
  ];
  const godRaysActions = {
    reset: () => {
      state.godRaysMode = DEFAULT_POST_PROCESS_SETTINGS.godRaysMode;
      state.godRaysDensity = DEFAULT_POST_PROCESS_SETTINGS.godRaysDensity;
      state.godRaysDecay = DEFAULT_POST_PROCESS_SETTINGS.godRaysDecay;
      state.godRaysWeight = DEFAULT_POST_PROCESS_SETTINGS.godRaysWeight;
      state.godRaysExposure = DEFAULT_POST_PROCESS_SETTINGS.godRaysExposure;
      applyPostProcessSettings();
      for (const controller of godRaysControllers) controller.updateDisplay();
    },
  };
  godRaysFolder.add(godRaysActions, "reset").name("reset");

  applyPostProcessSettings();
}
