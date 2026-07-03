import type { FarSummaryGpuAtlasFullUploadReason, FarSummaryGpuAtlasView } from "./gpu/farSummaryAtlas.js";

export type FarSummaryAtlasUploadMode = FarSummaryGpuAtlasView["uploadStats"]["lastUploadMode"];

export const FAR_SUMMARY_ATLAS_UPLOAD_MODE_CODE: Record<FarSummaryAtlasUploadMode, number> = {
  none: 0,
  dirty: 1,
  full: 2,
};

export const FAR_SUMMARY_ATLAS_UPLOAD_FALLBACK_REASON_CODE: Record<FarSummaryGpuAtlasFullUploadReason | "none", number> = {
  none: 0,
  initial: 1,
  explicit: 2,
  disabled: 3,
  too_many_rects: 4,
  threshold: 5,
  invalid_atlas: 6,
  partial_ranges_unsupported: 7,
  full_invalidation: 8,
};

export function farSummaryAtlasUploadModeCode(mode: FarSummaryAtlasUploadMode): number {
  return FAR_SUMMARY_ATLAS_UPLOAD_MODE_CODE[mode];
}

export function farSummaryAtlasUploadFallbackReasonCode(reason: FarSummaryGpuAtlasFullUploadReason | null): number {
  return FAR_SUMMARY_ATLAS_UPLOAD_FALLBACK_REASON_CODE[reason ?? "none"];
}
