import * as THREE from "three";
import type { TerrainColorAdjustments } from "../../material/material.js";
import {
  DEFAULT_ENVIRONMENT_COLORS,
  SkyEnvironment,
  type EnvironmentLighting,
  type EnvironmentSettings,
} from "../../environment/environment.js";
import type { PostProcessSettings } from "../../environment/postprocess.js";
import type { AppSky } from "../../scene/app_sky.js";
import { WebGpuSkyEnvironment } from "../../scene/webgpu_sky_environment.js";
import type { AppRenderer } from "./renderer_startup.js";
import type { ClodAppState } from "../clod_app_state.js";

export interface TerrainViewStateReaders {
  currentTerrainColorAdjustments: () => TerrainColorAdjustments;
  currentEnvironmentSettings: () => EnvironmentSettings;
  currentPostProcessSettings: () => PostProcessSettings;
}

export function createTerrainViewStateReaders(state: ClodAppState): TerrainViewStateReaders {
  return {
    currentTerrainColorAdjustments: () => ({
      brightness: state.terrainBrightness,
      contrast: state.terrainContrast,
      saturation: state.terrainSaturation,
      warmth: state.terrainWarmth,
    }),
    currentEnvironmentSettings: () => ({
      sunAzimuthDeg: state.sunAzimuthDeg,
      sunElevationDeg: state.sunElevationDeg,
      sunIntensity: state.sunIntensity,
      skyIntensity: state.skyIntensity,
      groundIntensity: state.groundIntensity,
      exposure: state.exposure,
      horizonSoftness: state.horizonSoftness,
      sunDiskIntensity: state.sunDiskIntensity,
      sunGlowIntensity: state.sunGlowIntensity,
      hazeIntensity: state.hazeIntensity,
    }),
    currentPostProcessSettings: () => ({
      enabled: state.postProcessEnabled,
      opacity: state.postProcessOpacity,
      renderScale: state.postProcessRenderScale,
      exposure: state.postProcessExposure,
      contrast: state.postProcessContrast,
      saturation: state.postProcessSaturation,
      vignette: state.postProcessVignette,
      debugMode: state.postProcessDebugMode,
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
    }),
  };
}

export function createTerrainViewSkyEnvironment(options: {
  app: AppRenderer;
  scene: THREE.Scene;
  worldCells: number;
  settings: EnvironmentSettings;
}): AppSky {
  const { app, scene, worldCells, settings } = options;
  return app.isWebGpu
    ? new WebGpuSkyEnvironment({
        scene,
        renderer: app.renderer,
        radius: Math.max(1600, worldCells * 5),
        settings,
      })
    : new SkyEnvironment({
        scene,
        renderer: app.renderer,
        radius: Math.max(1600, worldCells * 5),
        settings,
        colors: DEFAULT_ENVIRONMENT_COLORS,
      });
}

export function createCurrentLightingReader(skyEnvironment: AppSky): () => EnvironmentLighting {
  return () => skyEnvironment.lighting();
}
