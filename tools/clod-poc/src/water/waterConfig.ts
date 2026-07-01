// Config contract for the fake water clipmap (config/water.yaml).
//
// Water is a POC visual layer only. It never feeds the CLOD page source mesh,
// meshoptimizer simplification, page borders, LOD selection, colliders, or
// validation. The dependency direction is scene -> water, never pages -> water.
import { cloneWaterConfig as cloneWaterConfigDeep } from "./water_config_clone.js";
import { DEFAULT_WATER_CONFIG } from "./water_config_defaults.js";
import type { WaterConfig } from "./water_config_types.js";

export * from "./water_config_types.js";
export * from "./water_config_defaults.js";
export * from "./water_config_parsing.js";

export function cloneWaterConfig(config: WaterConfig = DEFAULT_WATER_CONFIG): WaterConfig {
  return cloneWaterConfigDeep(config);
}
