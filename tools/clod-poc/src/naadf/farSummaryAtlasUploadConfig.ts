export interface FarSummaryGpuAtlasUploadOptions {
  dirtyRectUploads?: boolean;
  fullUploadThresholdPct?: number;
  maxDirtyRectsPerTexture?: number;
}

export interface ResolvedFarSummaryGpuAtlasUploadOptions {
  dirtyRectUploads: boolean;
  fullUploadThresholdPct: number;
  maxDirtyRectsPerTexture: number;
}

export const DEFAULT_FAR_SUMMARY_ATLAS_DIRTY_RECT_UPLOADS = true;
export const DEFAULT_FAR_SUMMARY_ATLAS_FULL_UPLOAD_THRESHOLD_PCT = 0.35;
export const DEFAULT_FAR_SUMMARY_ATLAS_MAX_DIRTY_RECTS_PER_TEXTURE = 128;

export function resolveFarSummaryGpuAtlasUploadOptions(
  options: FarSummaryGpuAtlasUploadOptions = {},
): ResolvedFarSummaryGpuAtlasUploadOptions {
  return {
    dirtyRectUploads: options.dirtyRectUploads ?? DEFAULT_FAR_SUMMARY_ATLAS_DIRTY_RECT_UPLOADS,
    fullUploadThresholdPct: clampFraction(
      options.fullUploadThresholdPct,
      DEFAULT_FAR_SUMMARY_ATLAS_FULL_UPLOAD_THRESHOLD_PCT,
    ),
    maxDirtyRectsPerTexture: positiveInt(
      options.maxDirtyRectsPerTexture,
      DEFAULT_FAR_SUMMARY_ATLAS_MAX_DIRTY_RECTS_PER_TEXTURE,
    ),
  };
}

function clampFraction(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
