import type { ForestLightingStats } from "./forest_lighting_system.js";

export function formatForestLightingInfoLine(enabled: boolean, stats: ForestLightingStats | null): string {
  if (!enabled) return "forest light: disabled";
  if (!stats) return "forest light: pending";
  return `forest light: canopy=${stats.maxCanopy.toFixed(2)} ao=${stats.maxAo.toFixed(2)} ` +
    `shadow=${stats.maxShadow.toFixed(2)} fog=${stats.maxFog.toFixed(2)} tex=${stats.textureUpdates}`;
}
