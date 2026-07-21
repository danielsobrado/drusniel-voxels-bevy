export type WaterFoamRgb = readonly [number, number, number];

export const WATER_FOAM_REFERENCE_ALBEDO: WaterFoamRgb = [0.74, 0.76, 0.74];
export const WATER_FOAM_TINT_STRENGTH = 0.2;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
const MIN_LUMINANCE = 1e-4;

export function resolveWaterFoamAlbedo(configured: WaterFoamRgb): [number, number, number] {
  const luminance = Math.max(
    MIN_LUMINANCE,
    configured[0] * LUMA_R + configured[1] * LUMA_G + configured[2] * LUMA_B,
  );
  return [
    applyTint(WATER_FOAM_REFERENCE_ALBEDO[0], configured[0] / luminance),
    applyTint(WATER_FOAM_REFERENCE_ALBEDO[1], configured[1] / luminance),
    applyTint(WATER_FOAM_REFERENCE_ALBEDO[2], configured[2] / luminance),
  ];
}

function applyTint(reference: number, normalizedTint: number): number {
  const tint = 1 + (normalizedTint - 1) * WATER_FOAM_TINT_STRENGTH;
  return clamp01(reference * tint);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
