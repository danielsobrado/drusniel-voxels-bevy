import type { GrassSettings } from "./grass_config.js";
import type { GrassStats } from "./grass_stats.js";

function ms(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

export function logGrassProfile(
  stats: GrassStats,
  propsMs: number,
  enabled: boolean,
  makeGrassSettings: () => GrassSettings,
  prepassEnabled: boolean,
): void {
  if (!enabled) return;
  const settings = makeGrassSettings();
  console.log(
    `[grass] mode=${stats.mode} prepass=${prepassEnabled ? "on" : "off"} ` +
      `distance=${settings.distanceM.toFixed(1)}m blades=${stats.blades} patches=${stats.visiblePatches}/${stats.patches} ` +
      `tiers=${stats.nearPatches}/${stats.midPatches}/${stats.coveragePatches}/${stats.superPatches} ` +
      `candidates=${stats.acceptedCandidates}/${stats.generatedCandidates} edgeSuppressed=${stats.edgeSuppressedCandidates} ` +
      `buildMs=${stats.buildMs.toFixed(2)} propsMs=${propsMs.toFixed(2)} ` +
      `gpu=${stats.gpuRingStatus} visible=${stats.gpuRingVisibleNear}/${stats.gpuRingVisibleMid}/${stats.gpuRingVisibleFar}/${stats.gpuRingVisibleSuper} ` +
      `dispatchMs=${ms(stats.gpuRingDispatchMs)} readbackMs=${ms(stats.gpuRingReadbackMs)}`,
  );
}
