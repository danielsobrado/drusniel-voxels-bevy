export const MATERIAL_DEBUG_VIEW_IDS = [
  "final",
  "macro_noise",
  "material_weights",
  "material_id",
  "normal_strength",
  "roughness",
  "page_lod",
  "seam_stress",
] as const;

export type MaterialDebugViewId = typeof MATERIAL_DEBUG_VIEW_IDS[number];

export function materialDebugViewIndex(id: MaterialDebugViewId): number {
  return MATERIAL_DEBUG_VIEW_IDS.indexOf(id);
}
