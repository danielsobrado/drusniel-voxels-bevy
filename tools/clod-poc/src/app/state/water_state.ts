import { WATER_DEBUG_MODES } from "../../water/index.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { ProjectWaterArchiveState } from "../../project/project_archive.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface WaterSliceState {
  waterEnabled: boolean;
  waterDebugMode: keyof typeof WATER_DEBUG_MODES;
  waterClipmapTint: boolean;
  waterWireframe: boolean;
  waterDepthWrite: boolean;
}

const WATER_ARCHIVE_KEYS = [
  "waterEnabled", "waterDebugMode", "waterClipmapTint", "waterWireframe", "waterDepthWrite",
] as const satisfies readonly (keyof ProjectWaterArchiveState)[];

export function createWaterSliceState(waterConfig: WaterConfig): WaterSliceState {
  return {
    waterEnabled: waterConfig.enabled,
    waterDebugMode: (Object.entries(WATER_DEBUG_MODES).find(([, v]) => v === waterConfig.debug.mode)?.[0] ?? "final") as keyof typeof WATER_DEBUG_MODES,
    waterClipmapTint: waterConfig.debug.clipmapTint,
    waterWireframe: waterConfig.debug.wireframe,
    waterDepthWrite: waterConfig.visual.depthWrite,
  };
}

export function applyWaterArchiveState(
  target: WaterSliceState,
  archive: ProjectWaterArchiveState,
): void {
  assignArchiveFields(target, archive, WATER_ARCHIVE_KEYS);
}
