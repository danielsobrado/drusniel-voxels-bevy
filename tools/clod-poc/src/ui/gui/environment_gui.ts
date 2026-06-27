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
    environmentFolder.add(state, "hazeIntensity", 0, 1.5, 0.01).name("haze").onChange(deps.updateLighting),
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
    postFolder.add(state, "postProcessEnabled").name("enabled"),
    postFolder.add(state, "postProcessDebugMode", ["output", "copy", "off"]).name("mode"),
    postFolder.add(state, "postProcessOpacity", 0, 1, 0.01).name("copy opacity"),
    postFolder.add(state, "postProcessExposure", 0.25, 2.5, 0.01).name("pass exposure"),
    postFolder.add(state, "postProcessContrast", 0.25, 2.5, 0.01).name("contrast"),
    postFolder.add(state, "postProcessSaturation", 0, 2.5, 0.01).name("saturation"),
    postFolder.add(state, "postProcessVignette", 0, 1.5, 0.01).name("vignette"),
  ];
  const postActions = {
    reset: () => {
      state.postProcessEnabled = DEFAULT_POST_PROCESS_SETTINGS.enabled;
      state.postProcessOpacity = DEFAULT_POST_PROCESS_SETTINGS.opacity;
      state.postProcessExposure = DEFAULT_POST_PROCESS_SETTINGS.exposure;
      state.postProcessContrast = DEFAULT_POST_PROCESS_SETTINGS.contrast;
      state.postProcessSaturation = DEFAULT_POST_PROCESS_SETTINGS.saturation;
      state.postProcessVignette = DEFAULT_POST_PROCESS_SETTINGS.vignette;
      state.postProcessDebugMode = DEFAULT_POST_PROCESS_SETTINGS.debugMode;
      deps.postProcess?.updateSettings(deps.currentPostProcessSettings());
      for (const controller of postControllers) controller.updateDisplay();
    },
  };
  postFolder.add(postActions, "reset").name("reset");

  const godRaysFolder = gui.addFolder("god rays");
  const godRaysControllers: GuiController[] = [
    godRaysFolder
      .add(state, "godRaysMode", ["off", "cheap", "heavy", "volumetric"])
      .name("mode (WebGPU)"),
    godRaysFolder.add(state, "godRaysDensity", 0.5, 1.5, 0.01).name("density"),
    godRaysFolder.add(state, "godRaysDecay", 0.8, 0.99, 0.005).name("decay"),
    godRaysFolder.add(state, "godRaysWeight", 0.0, 1.0, 0.01).name("weight"),
    godRaysFolder.add(state, "godRaysExposure", 0.0, 2.0, 0.01).name("exposure"),
  ];
  const godRaysActions = {
    reset: () => {
      state.godRaysMode = DEFAULT_POST_PROCESS_SETTINGS.godRaysMode;
      state.godRaysDensity = DEFAULT_POST_PROCESS_SETTINGS.godRaysDensity;
      state.godRaysDecay = DEFAULT_POST_PROCESS_SETTINGS.godRaysDecay;
      state.godRaysWeight = DEFAULT_POST_PROCESS_SETTINGS.godRaysWeight;
      state.godRaysExposure = DEFAULT_POST_PROCESS_SETTINGS.godRaysExposure;
      deps.postProcess?.updateSettings(deps.currentPostProcessSettings());
      for (const controller of godRaysControllers) controller.updateDisplay();
    },
  };
  godRaysFolder.add(godRaysActions, "reset").name("reset");
}
