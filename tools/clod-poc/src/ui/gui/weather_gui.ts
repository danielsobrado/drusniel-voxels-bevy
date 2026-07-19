import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { WEATHER_MODE_OPTIONS } from "../../app/clod_constants.js";
import type { WeatherController } from "../../runtime/water_weather/weather_controller.js";
import type { GuiController } from "./gui_controller.js";

export interface WeatherGuiDeps {
  weatherController: WeatherController;
  applyWeatherSettings: () => void;
}

export interface WeatherGuiResult {
  weatherStatsController: GuiController | null;
}

export function createWeatherGui(
  gui: GUI,
  state: ClodAppState,
  deps: WeatherGuiDeps,
): WeatherGuiResult {
  const weatherFolder = gui.addFolder("weather");
  weatherFolder.add(state, "weatherMode", WEATHER_MODE_OPTIONS).name("mode").onChange(deps.applyWeatherSettings);
  weatherFolder.add(state, "weatherIntensity", 0, 1.6, 0.05).name("intensity").onChange(deps.applyWeatherSettings);
  weatherFolder.add(state, "weatherWindX", -5, 5, 0.05).name("wind X").onChange(deps.applyWeatherSettings);
  weatherFolder.add(state, "weatherWindZ", -5, 5, 0.05).name("wind Z").onChange(deps.applyWeatherSettings);

  const moteFolder = weatherFolder.addFolder("sunbeam motes");
  const motes = deps.weatherController.getSunbeamMoteSettings();
  const applyMotes = () => deps.weatherController.setSunbeamMoteSettings(motes);
  moteFolder.add(motes, "enabled").name("enabled").onChange(applyMotes);
  moteFolder.add(motes, "strength", 0, 1, 0.02).name("strength").onChange(applyMotes);
  moteFolder.add(motes, "density", 0, 1, 0.02).name("density").onChange(applyMotes);
  moteFolder.add(motes, "opacity", 0, 1, 0.02).name("opacity").onChange(applyMotes);
  moteFolder.add(motes, "maxParticles", 0, 1200, 25).name("max particles").onChange(applyMotes);
  moteFolder.add(motes, "spawnRadiusM", 4, 96, 1).name("radius m").onChange(applyMotes);
  moteFolder.add(motes, "fadeStartM", 0, 96, 1).name("fade start m").onChange(applyMotes);
  moteFolder.add(motes, "fadeEndM", 0, 96, 1).name("fade end m").onChange(applyMotes);
  moteFolder.add(motes, "visibilityStart", 0, 1, 0.02).name("visibility start").onChange(applyMotes);
  moteFolder.add(motes, "visibilityEnd", 0, 1, 0.02).name("visibility end").onChange(applyMotes);
  moteFolder.add(motes, "forwardScatterPower", 1, 32, 0.5).name("shaft focus").onChange(applyMotes);
  moteFolder.add(motes, "mistFloor", 0, 1, 0.02).name("mist floor").onChange(applyMotes);

  const weatherStatsController = weatherFolder.add(state, "weatherStats").name("shader stats").disable();
  deps.weatherController.bindStatsController(weatherStatsController);
  return { weatherStatsController };
}
