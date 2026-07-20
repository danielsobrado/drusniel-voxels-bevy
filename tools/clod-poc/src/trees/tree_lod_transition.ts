import type { TreeSettings } from "./tree_config.js";

/** Half-width of the LOD crossfade transition. Config stores the full band width. */
export function treeLodCrossfadeHalfBandM(settings: TreeSettings): number {
  if (!settings.lod.crossfadeEnabled || !settings.lod.ditherEnabled) {
    return 0;
  }
  return Math.max(0, settings.lod.crossfadeBandM * 0.5);
}

export function smoothstep01(start: number, end: number, value: number): number {
  const span = end - start;
  if (!(span > 0)) return value >= end ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - start) / span));
  return t * t * (3 - 2 * t);
}

/** Fraction of the tree impostor that remains visible before the far-canopy takes over. */
export function treeImpostorVisibility(distanceM: number, settings: TreeSettings): number {
  return 1 - smoothstep01(settings.lod.canopyFadeStartM, settings.lod.canopyFadeEndM, distanceM);
}

/** Fraction of the far-canopy that is faded in across the handoff band. */
export function canopyVisibility(distanceM: number, startM: number, endM: number): number {
  return smoothstep01(startM, endM, distanceM);
}
