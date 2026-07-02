export type FarSummaryAtlasFormat = "debug_rgba32f" | "balanced" | "packed_low_bandwidth";
export type FarSummaryAtlasHeightFormat = "r32f" | "r16f";

export const DEFAULT_FAR_SUMMARY_ATLAS_FORMAT: FarSummaryAtlasFormat = "balanced";

const FORMAT_VALUES: ReadonlySet<string> = new Set([
  "debug_rgba32f",
  "balanced",
  "packed_low_bandwidth",
]);

const FLOAT32_BYTES = 4;
const FLOAT16_BYTES = 2;
const UINT8_BYTES = 1;
const RGBA_COMPONENTS = 4;
const RED_COMPONENTS = 1;

export interface FarSummaryAtlasPackingSpec {
  readonly format: FarSummaryAtlasFormat;
  readonly heightFormat: FarSummaryAtlasHeightFormat;
  readonly heightComponents: number;
  readonly heightBytesPerPixel: number;
  readonly materialBytesPerPixel: number;
  readonly coverageBytesPerPixel: number;
  readonly normalBytesPerPixel: number;
  readonly storesHeightRange: boolean;
  readonly storesNormalAtlas: boolean;
}

export interface FarSummaryAtlasByteEstimate {
  readonly heightBytes: number;
  readonly materialBytes: number;
  readonly coverageBytes: number;
  readonly normalBytes: number;
  readonly totalBytes: number;
  readonly debugRgba32fBytes: number;
  readonly savingsBytes: number;
  readonly savingsPct: number;
}

export function isValidFarSummaryAtlasFormat(value: string): value is FarSummaryAtlasFormat {
  return FORMAT_VALUES.has(value);
}

export function resolveFarSummaryAtlasPackingSpec(format: FarSummaryAtlasFormat = DEFAULT_FAR_SUMMARY_ATLAS_FORMAT): FarSummaryAtlasPackingSpec {
  if (format === "debug_rgba32f") {
    return {
      format,
      heightFormat: "r32f",
      heightComponents: RGBA_COMPONENTS,
      heightBytesPerPixel: RGBA_COMPONENTS * FLOAT32_BYTES,
      materialBytesPerPixel: RGBA_COMPONENTS * FLOAT32_BYTES,
      coverageBytesPerPixel: RGBA_COMPONENTS * FLOAT32_BYTES,
      normalBytesPerPixel: RGBA_COMPONENTS * FLOAT32_BYTES,
      storesHeightRange: true,
      storesNormalAtlas: true,
    };
  }

  if (format === "packed_low_bandwidth") {
    return {
      format,
      heightFormat: "r16f",
      heightComponents: RED_COMPONENTS,
      heightBytesPerPixel: RED_COMPONENTS * FLOAT16_BYTES,
      materialBytesPerPixel: RGBA_COMPONENTS * UINT8_BYTES,
      coverageBytesPerPixel: RGBA_COMPONENTS * UINT8_BYTES,
      normalBytesPerPixel: RGBA_COMPONENTS * UINT8_BYTES,
      storesHeightRange: false,
      storesNormalAtlas: false,
    };
  }

  return {
    format,
    heightFormat: "r32f",
    heightComponents: RED_COMPONENTS,
    heightBytesPerPixel: RED_COMPONENTS * FLOAT32_BYTES,
    materialBytesPerPixel: RGBA_COMPONENTS * UINT8_BYTES,
    coverageBytesPerPixel: RGBA_COMPONENTS * UINT8_BYTES,
    normalBytesPerPixel: RGBA_COMPONENTS * UINT8_BYTES,
    storesHeightRange: false,
    storesNormalAtlas: false,
  };
}

export function estimateFarSummaryAtlasBytes(width: number, height: number, spec: FarSummaryAtlasPackingSpec): FarSummaryAtlasByteEstimate {
  const pixels = Math.max(0, Math.floor(width)) * Math.max(0, Math.floor(height));
  const debugRgba32fBytes = pixels * RGBA_COMPONENTS * FLOAT32_BYTES * 4;
  const heightBytes = pixels * spec.heightBytesPerPixel;
  const materialBytes = pixels * spec.materialBytesPerPixel;
  const coverageBytes = pixels * spec.coverageBytesPerPixel;
  const normalBytes = spec.storesNormalAtlas
    ? pixels * spec.normalBytesPerPixel
    : spec.normalBytesPerPixel;
  const totalBytes = heightBytes + materialBytes + coverageBytes + normalBytes;
  const savingsBytes = Math.max(0, debugRgba32fBytes - totalBytes);
  const savingsPct = debugRgba32fBytes > 0 ? savingsBytes / debugRgba32fBytes : 0;

  return {
    heightBytes,
    materialBytes,
    coverageBytes,
    normalBytes,
    totalBytes,
    debugRgba32fBytes,
    savingsBytes,
    savingsPct,
  };
}

export function packUnorm8(value: number): number {
  return Math.round(clamp01(value) * 255);
}

export function unpackUnorm8(value: number): number {
  return clamp01(Math.round(value) / 255);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
