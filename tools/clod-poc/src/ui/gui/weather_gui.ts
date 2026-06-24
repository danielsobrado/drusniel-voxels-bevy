import type GUI from "lil-gui";
import { WEATHER_MODE_OPTIONS } from "../../app/clod_constants.js";
import type { WeatherController } from "../../systems/weather_controller.js";
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
  state: Record<string, unknown>,
  deps: WeatherGuiDeps,
): WeatherGuiResult {
  const weatherFolder = gui.addFolder("weather");
  weatherFolder.add(state, "weatherMode", WEATHER_MODE_OPTIONS).name("mode").onChange(deps.applyWeatherSettings);
  weatherFolder.add(state, "weatherIntensity", 0, 1.6, 0.05).name("intensity").onChange(deps.applyWeatherSettings);
  weatherFolder.add(state, "weatherWindX", -5, 5, 0.05).name("wind X").onChange(deps.applyWeatherSettings);
  weatherFolder.add(state, "weatherWindZ", -5, 5, 0.05).name("wind Z").onChange(deps.applyWeatherSettings);
  const weatherStatsController = weatherFolder.add(state, "weatherStats").name("shader stats").disable();
  deps.weatherController.bindStatsController(weatherStatsController);
  return { weatherStatsController };
}
