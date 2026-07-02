import { load } from "js-yaml";
import sunLightYaml from "../../app/config/sun_light.yaml?raw";
import { parseSunLightOptions, SUN_LIGHT_DEFAULTS, type SunLightOptions } from "./sun_light_options.js";

export function loadBundledSunLightOptions(): SunLightOptions {
  try {
    return parseSunLightOptions(load(sunLightYaml));
  } catch {
    return SUN_LIGHT_DEFAULTS;
  }
}
