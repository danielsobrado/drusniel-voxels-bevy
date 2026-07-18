import {
  cloneEnvironmentalMaskSettings,
  parseEnvironmentalMaskConfig,
} from "./environment_mask_config.js";
import type { EnvironmentalMaskSettings } from "./environment_mask_types.js";

type WarnHandler = (message: string) => void;

let settings = cloneEnvironmentalMaskSettings();

export function configureEnvironmentalMaskSettings(
  configText: string | null | undefined,
  warn: WarnHandler | null = console.warn,
): EnvironmentalMaskSettings {
  const next = parseEnvironmentalMaskConfig(configText, warn);
  setEnvironmentalMaskSettings(next);
  return readEnvironmentalMaskSettings();
}

export function setEnvironmentalMaskSettings(next: EnvironmentalMaskSettings): void {
  settings = cloneEnvironmentalMaskSettings(next);
}

export function readEnvironmentalMaskSettings(): EnvironmentalMaskSettings {
  return cloneEnvironmentalMaskSettings(settings);
}
