export const TREE_LOD_DITHER_X = 0.06711056;
export const TREE_LOD_DITHER_Y = 0.00583715;
export const TREE_LOD_DITHER_SCALE = 52.9829189;

export interface TreeLodBoundaryFade {
  fadeIn: number;
  fadeOut: number;
}

export interface TreeLodBoundaryKeep {
  farKeep: boolean;
  impostorKeep: boolean;
}

export function treeLodInterleavedGradientNoise(x: number, y: number): number {
  return fract(TREE_LOD_DITHER_SCALE * fract(x * TREE_LOD_DITHER_X + y * TREE_LOD_DITHER_Y));
}

export function treeLodBoundaryFade(distanceM: number, boundaryM: number, bandM: number): TreeLodBoundaryFade {
  if (bandM <= 1e-4) {
    const fadeIn = distanceM >= boundaryM ? 1 : 0;
    return { fadeIn, fadeOut: 1 - fadeIn };
  }
  const fadeIn = smoothstep(boundaryM - bandM, boundaryM + bandM, distanceM);
  return { fadeIn, fadeOut: 1 - fadeIn };
}

export function treeFarToImpostorBoundaryKeep(
  noise: number,
  distanceM: number,
  farBoundaryM: number,
  bandM: number,
): TreeLodBoundaryKeep {
  const fade = treeLodBoundaryFade(distanceM, farBoundaryM, bandM);
  return {
    farKeep: treeLodFadeOutKeep(noise, fade.fadeOut),
    impostorKeep: treeLodFadeInKeep(noise, fade.fadeIn),
  };
}

export function treeLodFadeInKeep(noise: number, fadeIn: number): boolean {
  return clamp01(noise) >= 1 - clamp01(fadeIn);
}

export function treeLodFadeOutKeep(noise: number, fadeOut: number): boolean {
  return clamp01(noise) < clamp01(fadeOut);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
