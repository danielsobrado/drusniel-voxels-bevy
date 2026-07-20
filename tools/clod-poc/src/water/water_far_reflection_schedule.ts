import type { WaterFarSummaryReflectionConfig } from "./water_config_types.js";

export function waterFarReflectionMarchDistances(
  config: Pick<WaterFarSummaryReflectionConfig, "maxSteps" | "startDistanceM" | "maxDistanceM" | "stepGrowth">,
): number[] {
  const maxSteps = Math.max(0, Math.floor(finite(config.maxSteps, 0)));
  const maxDistanceM = Math.max(0, finite(config.maxDistanceM, 0));
  const growth = Math.max(1.01, finite(config.stepGrowth, 1.01));
  let distanceM = Math.max(0, finite(config.startDistanceM, 0));
  const distances: number[] = [];
  for (let step = 0; step < maxSteps && distanceM <= maxDistanceM; step += 1) {
    distances.push(distanceM);
    distanceM *= growth;
  }
  return distances;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
