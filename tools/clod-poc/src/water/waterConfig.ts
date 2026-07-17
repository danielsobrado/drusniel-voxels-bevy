// Rendering configuration for the water clipmap and legacy fake-body fallback.
//
// Gameplay does not query clipmap geometry or visual shore shaping. Canonical gameplay
// water authority lives in water_authority.ts and consumes hydrology or explicit edited
// bodies. The dependency direction remains world authority -> water rendering/gameplay;
// water visuals never mutate terrain pages, LOD selection, or colliders.
import { cloneWaterConfig as cloneWaterConfigDeep } from "./water_config_clone.js";
import { DEFAULT_WATER_CONFIG } from "./water_config_defaults.js";
import type { WaterConfig } from "./water_config_types.js";

export * from "./water_config_types.js";
export * from "./water_config_defaults.js";
export * from "./water_config_parsing.js";

export function cloneWaterConfig(config: WaterConfig = DEFAULT_WATER_CONFIG): WaterConfig {
  return cloneWaterConfigDeep(config);
}
