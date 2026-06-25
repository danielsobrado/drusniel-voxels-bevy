import * as THREE from "three";
import {
  RainWeatherSystem,
  SandstormWeatherSystem,
  SnowWeatherSystem,
  StormLightningSystem,
  type RainWeatherSettings,
  type SandstormWeatherSettings,
  type SnowWeatherSettings,
  type StormWeatherSettings,
} from "../../weather/rain.js";

export interface WeatherUiSettings {
  weatherMode: "off" | "rain" | "snow" | "sandstorm" | "storm";
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
  setStatsText: (text: string) => void;
}

export interface WeatherController {
  applySettings(): void;
  refreshStats(): void;
  update(
    deltaSeconds: number,
    elapsedSeconds: number,
    cameraPosition: THREE.Vector3,
    effectCenter: THREE.Vector3,
  ): void;
  bindStatsController(controller: { updateDisplay: () => unknown }): void;
  dispose(): void;
}

export function createWeatherController(deps: WeatherControllerDeps): WeatherController {
  const rainWeather = new RainWeatherSystem({
    scene: deps.scene,
    isWebGpu: deps.isWebGpu,
    worldCells: deps.worldCells,
    seed: 0xdecafbad,
    samplers: {
      surfaceHeight: deps.surfaceHeight,
      surfaceNormal: deps.surfaceNormal,
      waterSample: deps.waterSample,
    },
  });
  const snowWeather = new SnowWeatherSystem({
    scene: deps.scene,
    isWebGpu: deps.isWebGpu,
    seed: 0x51eaf00d,
  });
  const sandstormWeather = new SandstormWeatherSystem({
    scene: deps.scene,
    camera: deps.camera,
    isWebGpu: deps.isWebGpu,
    seed: 0x5a4d570d,
  });
  const stormWeather = new StormLightningSystem({
    scene: deps.scene,
    camera: deps.camera,
    isWebGpu: deps.isWebGpu,
  });

  let statsController: { updateDisplay: () => unknown } | null = null;

  const currentRainWeatherSettings = (): RainWeatherSettings => {
    const settings = deps.getSettings();
    return {
      enabled: settings.weatherMode === "rain",
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentSnowWeatherSettings = (): SnowWeatherSettings => {
    const settings = deps.getSettings();
    return {
      enabled: settings.weatherMode === "snow",
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentSandstormWeatherSettings = (): SandstormWeatherSettings => {
    const settings = deps.getSettings();
    return {
      enabled: settings.weatherMode === "sandstorm",
      intensity: settings.weatherIntensity,
      windX: settings.weatherWindX,
      windZ: settings.weatherWindZ,
    };
  };
  const currentStormWeatherSettings = (): StormWeatherSettings => {
    const settings = deps.getSettings();
    return {
      enabled: settings.weatherMode === "storm",
      intensity: settings.weatherIntensity,
    };
  };

  const refreshStats = () => {
    const settings = deps.getSettings();
    if (settings.weatherMode === "rain") {
      const stats = rainWeather.getStats();
      deps.setStatsText(`rain terrain ${stats.hardSplashes} / water ${stats.waterSplashes}`);
    } else if (settings.weatherMode === "snow") {
      const stats = snowWeather.getStats();
      deps.setStatsText(`snow ${stats.flakes} flakes`);
    } else if (settings.weatherMode === "sandstorm") {
      const stats = sandstormWeather.getStats();
      deps.setStatsText(`sandstorm ${stats.particles} puffs${stats.haze ? " + haze" : ""}`);
    } else if (settings.weatherMode === "storm") {
      const stats = stormWeather.getStats();
      deps.setStatsText(`storm lightning ${stats.active ? "on" : "off"}`);
    } else {
      deps.setStatsText("off");
    }
  };

  const applySettings = () => {
    rainWeather.applySettings(currentRainWeatherSettings());
    snowWeather.applySettings(currentSnowWeatherSettings());
    sandstormWeather.applySettings(currentSandstormWeatherSettings());
    stormWeather.applySettings(currentStormWeatherSettings());
    refreshStats();
    statsController?.updateDisplay();
  };

  applySettings();

  return {
    applySettings,
    refreshStats,
    update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter) {
      rainWeather.update(deltaSeconds, elapsedSeconds, cameraPosition, effectCenter);
      snowWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      sandstormWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
      stormWeather.update(deltaSeconds, elapsedSeconds, cameraPosition);
    },
    bindStatsController(controller) {
      statsController = controller;
    },
    dispose() {
      rainWeather.dispose();
      snowWeather.dispose();
      sandstormWeather.dispose();
      stormWeather.dispose();
    },
  };
}
