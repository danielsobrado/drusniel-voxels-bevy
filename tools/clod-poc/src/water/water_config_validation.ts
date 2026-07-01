import type { RiverBodyConfig, WaterConfig } from "./waterConfig.js";
import { isWaterDebugModeId, riverHasValidPoints } from "./water_config_guards.js";

export function validateWaterConfig(
  config: WaterConfig,
  defaultDebugMode: WaterConfig["debug"]["mode"],
  warn: ((message: string) => void) | null,
): WaterConfig {
  const debugMode = isWaterDebugModeId(config.debug.mode) ? config.debug.mode : defaultDebugMode;
  const rivers = filterValidRivers(config.fakeBodies.rivers, warn);

  if (debugMode === config.debug.mode && rivers.length === config.fakeBodies.rivers.length) {
    return config;
  }

  return {
    ...config,
    debug: { ...config.debug, mode: debugMode },
    fakeBodies: { ...config.fakeBodies, rivers },
  };
}

function filterValidRivers(
  source: RiverBodyConfig[],
  warn: ((message: string) => void) | null,
): RiverBodyConfig[] {
  const rivers: RiverBodyConfig[] = [];
  for (const [idx, river] of source.entries()) {
    if (!riverHasValidPoints(river)) {
      warn?.(`[water-config] skipping river entry ${idx}: expected at least 2 valid points or points_norm entries`);
      continue;
    }
    rivers.push(river);
  }
  return rivers;
}
