/**
 * Shared grass albedo palette (linear RGB). Blade bases, the far-clipmap
 * meadow color, and stone moss tint all read from here so grass roots and the
 * soil they stand on resolve to one color — coverage then reads as continuous
 * instead of dark blade roots on a brighter floor.
 */
export type LinearRgb = readonly [number, number, number];

export const GRASS_SHARED_BASE_LINEAR: LinearRgb = [0.18, 0.34, 0.12];
export const GRASS_TIP_LINEAR: LinearRgb = [0.30, 0.42, 0.14];
export const GRASS_DRY_LINEAR: LinearRgb = [0.30, 0.24, 0.09];

function linearToSrgbChannel(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function srgbToLinearChannel(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Linear RGB → "#rrggbb" (sRGB) for lil-gui color pickers. */
export function linearRgbToHex(rgb: LinearRgb): string {
  const to255 = (c: number) => Math.round(linearToSrgbChannel(c) * 255).toString(16).padStart(2, "0");
  return `#${to255(rgb[0])}${to255(rgb[1])}${to255(rgb[2])}`;
}

/** "#rrggbb" (sRGB) → linear RGB tuple; falls back on malformed input. */
export function hexToLinearRgb(hex: string, fallback: LinearRgb): [number, number, number] {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return [fallback[0], fallback[1], fallback[2]];
  const raw = parseInt(match[1] as string, 16);
  return [
    srgbToLinearChannel(((raw >> 16) & 0xff) / 255),
    srgbToLinearChannel(((raw >> 8) & 0xff) / 255),
    srgbToLinearChannel((raw & 0xff) / 255),
  ];
}
