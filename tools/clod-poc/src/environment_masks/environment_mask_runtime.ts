import {
  cloneEnvironmentalMaskSettings,
  type EnvironmentalMaskSettings,
} from "./environment_mask_config.js";

let settings = cloneEnvironmentalMaskSettings();

export function setEnvironmentalMaskSettings(next: EnvironmentalMaskSettings): void {
  settings = cloneEnvironmentalMaskSettings(next);
}

export function readEnvironmentalMaskSettings(): EnvironmentalMaskSettings {
  return settings;
}
