import { WATER_DEBUG_MODES } from "../../water/index.js";
import type { WaterConfig } from "../../water/waterConfig.js";

export interface WaterSliceState {
  waterEnabled: boolean;
  waterDebugMode: keyof typeof WATER_DEBUG_MODES;
  waterClipmapTint: boolean;
  waterWireframe: boolean;
  waterDepthWrite: boolean;
}

export function createWaterSliceState(waterConfig: WaterConfig): WaterSliceState {
  return {
    waterEnabled: waterConfig.enabled,
    waterDebugMode: (Object.entries(WATER_DEBUG_MODES).find(([, v]) => v === waterConfig.debug.mode)?.[0] ?? "final") as keyof typeof WATER_DEBUG_MODES,
    waterClipmapTint: waterConfig.debug.clipmapTint,
    waterWireframe: waterConfig.debug.wireframe,
    waterDepthWrite: waterConfig.visual.depthWrite,
  };
}
