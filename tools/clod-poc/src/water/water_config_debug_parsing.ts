import type { WaterDebugConfig } from "./water_config_types.js";
import { readBoolean, readNumber, recordFrom } from "./water_config_readers.js";

export function readWaterDebugConfig(value: unknown, defaults: WaterDebugConfig): WaterDebugConfig {
  const debug = recordFrom(value);
  return {
    mode: readNumber(debug.mode, defaults.mode) as WaterDebugConfig["mode"],
    clipmapTint: readBoolean(debug.clipmap_tint ?? debug.clipmapTint, defaults.clipmapTint),
    wireframe: readBoolean(debug.wireframe, defaults.wireframe),
  };
}
