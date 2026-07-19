import * as THREE from "three";
import type { EnvironmentLighting } from "../../environment/environment.js";
import { readActiveBiomeVisualState } from "../../environment/biome_visual_state_runtime.js";
import { MeadowWeatherSystem, type MeadowWeatherSettings } from "../../weather/meadow.js";
import {
  readSunbeamMoteRuntimeSettings,
  resolveSunbeamMoteVisualState,
  sanitizeSunbeamMoteRuntimeSettings,
  type SunbeamMoteRuntimeSettings,
} from "../../weather/sunbeam_mote_runtime.js";
import {
  RainWeatherSystem,
  SandstormWeatherSystem,
  SnowWeatherSystem,
  type RainWeatherSettings,
  type SandstormWeatherSettings,
  type SnowWeatherSettings,
  type StormWeatherSettings,
} from "../../weather/rain.js";
import { StormLightningSystem } from "../../weather/storm_ground.js";
import { WindWeatherSystem, type WindWeatherSettings } from "../../weather/wind.js";

export interface WeatherUiSettings {
  weatherMode: "off" | "meadow" | "rain" | "snow" | "sandstorm" | "storm" | "wind";
  weatherIntensity: number;
  weatherWindX: number;
  weatherWindZ: number;
}

export interface WeatherControllerDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  isWebGpu: boolean;
  worldCells: number;
  surfaceHeight: (x: number, z: number) => number;
  surfaceNormal: (x: number, z: number) => [number, number, number];
  waterSample: (x: number, z: number) => ReturnType<import("../../water/index.js").WaterField["sample"]>;
  getSettings: () => WeatherUiSettings;
  getLighting: () => EnvironmentLighting;
  setStatsText: (text: string) => void;
}

export interface WeatherController {
  applySettings(): void;
  refreshStats(): void;
  getSunbeamMoteSettings(): SunbeamMoteRuntimeSettings;
  setSunbeamMoteSettings(settings: Partial<SunbeamMoteRuntimeSettings>): void;
  update(deltaSeconds: number, elapsedSeconds: number, cameraPosition: THREE.Vector3, effectCenter: THREE.Vector3): void;
  bindStatsController(controller: { updateDisplay: () => unknown }): void;
  dispose(): void;
}

export function createWeatherController(deps: WeatherControllerDeps): WeatherController {
  let sunbeamMotes = readSunbeamMoteRuntimeSettings(deps.getSettings().weatherMode === "meadow");
  const meadowWeather = new MeadowWeatherSystem({ scene: deps.scene, isWebGpu: deps.isWebGpu, seed: 0x6d3a8f21 });
  const windWeather = new WindWeatherSystem({ scene: deps.scene, camera: deps.camera, isWebGpu: deps.isWebGpu, seed: 0x71f14d11 });
  const rainWeather = new RainWeatherSystem({
    scene: deps.scene, isWebGpu: deps.isWebGpu, worldCells: deps.worldCells, seed: 0xdecafbad,
    samplers: { surfaceHeight: deps.surfaceHeight, surfaceNormal: deps.surfaceNormal, waterSample: deps.waterSample },
  });
  const snowWeather = new SnowWeatherSystem({ scene: deps.scene, isWebGpu: deps.isWebGpu, seed: 0x51eaf00d });
  const sandstormWeather = new SandstormWeatherSystem({ scene: deps.scene, camera: deps.camera, isWebGpu: deps.isWebGpu, seed: 0x5a4d570d });
  const stormWeather = new StormLightningSystem({
    scene: deps.scene, isWebGpu: deps.isWebGpu, worldCells: deps.worldCells, seed: 0x57a4d0c7,
    samplers: { surfaceHeight: deps.surfaceHeight, surfaceNormal: deps.surfaceNormal, waterSample: deps.waterSample },
  });
  let statsController: { updateDisplay: () => unknown } | null = null;

  const currentMeadowSettings = (): MeadowWeatherSettings => {
    const settings = deps.getSettings();
    return {
      enabled: true,
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
      motes: cloneMoteSettings(sunbeamMotes),
    };
  };
  const currentWindSettings = (): WindWeatherSettings => {
    const settings = deps.getSettings();
    return { enabled: settings.weatherMode === "wind", intensity: settings.weatherIntensity, windX: settings.weatherWindX, windZ: settings.weatherWindZ };
  };
  const currentRainSettings = (): RainWeatherSettings => {
    const settings = deps.getSettings();
    return { enabled: settings.weatherMode === "rain", intensity: settings.weatherIntensity, windX: settings.weatherWindX, windZ: settings.weatherWindZ };
  };
  const currentSnowSettings = (): SnowWeatherSettings => {
    const settings = deps.getSettings();
    return { enabled: settings.weatherMode === "snow", intensity: settings.weatherIntensity, windX: settings.weatherWindX, windZ: settings.weatherWindZ };
  };
  const currentSandstormSettings = (): SandstormWeatherSettings => {
    const settings = deps.getSettings();
    return { enabled: settings.weatherMode === "sandstorm", intensity: settings.weatherIntensity, windX: settings.weatherWindX, windZ: settings.weatherWindZ };
  };
  const currentStormSettings = (): StormWeatherSettings => {
    const settings = deps.getSettings();
    return { enabled: settings.weatherMode === "storm", intensity: settings.weatherIntensity };
  };

  const refreshStats = () => {
    const settings = deps.getSettings();
    const parts: string[] = [];
    const moteStats = meadowWeather.getStats();
    if (sunbeamMotes.enabled) {
      parts.push(`motes ${moteStats.particles} atlas ${moteStats.atlasValid ? "ready" : "pending"} amount ${moteStats.visualAmount.toFixed(2)}`);
    }
    if (settings.weatherMode === "wind") {
      parts.push(`wind ${windWeather.getStats().ribbons} noise ribbons`);
    } else if (settings.weatherMode === "rain") {
      const stats = rainWeather.getStats();
      parts.push(`rain terrain ${stats.hardSplashes} / water ${stats.waterSplashes}`);
    } else if (settings.weatherMode === "snow") {
      parts.push(`snow ${snowWeather.getStats().flakes} flakes`);
    } else if (settings.weatherMode === "sandstorm") {
      const stats = sandstormWeather.getStats();
      parts.push(`sandstorm ${stats.particles} puffs${stats.haze ? " + haze" : ""}`);
    } else if (settings.weatherMode === "storm") {
      parts.push(`storm ground lightning ${stormWeather.getStats().active ? "on" : "off"}`);
    }
    deps.setStatsText(parts.length > 0 ? parts.join(" | ") : "off");
  };

  const applySettings = () => {
    meadowWeather.applySettings(currentMeadowSettings());
    windWeather.applySettings(currentWindSettings());
    rainWeather.applySettings(currentRainSettings());
    snowWeather.applySettings(currentSnowSettings());
    sandstormWeather.applySettings(currentSandstormSettings());
    stormWeather.applySettings(currentStormSettings());
    refreshStats();
    statsController?.updateDisplay();
  };
  applySettings();

  return {
    applySettings,
    refreshStats,
    getSunbeamMoteSettings: () => cloneMoteSettings(sunbeamMotes),
    setSunbeamMoteSettings(next) {
      sunbeamMotes = sanitizeSunbeamMoteRuntimeSettings({
        ...sunbeamMotes,
        ...next,
        warmColorRgb: next.warmColorRgb ? [...next.warmColorRgb] : [...sunbeamMotes.warmColorRgb],
        coldColorRgb: next.coldColorRgb ? [...next.coldColorRgb] : [...sunbeamMotes.coldColorRgb],
      });
      meadowWeather.applySettings(currentMeadowSettings());
      refreshStats();
      statsController?.updateDisplay();
    },
    update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter) {
      const visual = resolveSunbeamMoteVisualState(readActiveBiomeVisualState());
      const lighting = deps.getLighting();
      meadowWeather.update(deltaSeconds, elapsedSeconds, effectCenter, {
        cameraPosition,
        sunDirection: lighting.sunDirection,
        amount: visual.amount,
        coldBlend: visual.coldBlend,
        localMist: visual.localMist,
      });
      windWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      rainWeather.update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter);
      snowWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      sandstormWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      stormWeather.update(deltaSeconds, elapsedSeconds, effectCenter);
    },
    bindStatsController(controller) { statsController = controller; },
    dispose() {
      meadowWeather.dispose(); windWeather.dispose(); rainWeather.dispose();
      snowWeather.dispose(); sandstormWeather.dispose(); stormWeather.dispose();
    },
  };
}

function cloneMoteSettings(settings: SunbeamMoteRuntimeSettings): SunbeamMoteRuntimeSettings {
  return { ...settings, warmColorRgb: [...settings.warmColorRgb], coldColorRgb: [...settings.coldColorRgb] };
}
