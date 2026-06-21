import type { UnderstoryClass, UnderstorySettings } from "./understory_config.js";
import { clamp, clamp01, fractalNoise2D, smoothstep, valueNoise2D } from "../trees/tree_noise.js";

export interface UnderstoryEcologySample {
  forestInfluence: number;
  forestEdge: number;
  shade: number;
  moisture: number;
  clearing: number;
  density: number;
  deadfall: number;
}

export type TreeInfluenceSampler = (x: number, z: number) => number;

export function sampleUnderstoryEcology(
  x: number,
  z: number,
  height: number,
  normalY: number,
  groundWeight: number,
  settings: UnderstorySettings,
  treeInfluence?: TreeInfluenceSampler,
): UnderstoryEcologySample {
  const ecology = settings.ecology;
  if (!ecology.enabled) {
    return {
      forestInfluence: 0.5,
      forestEdge: 0.5,
      shade: 0.5,
      moisture: 0.5,
      clearing: 0.5,
      density: clamp01(groundWeight),
      deadfall: 0.25,
    };
  }

  const seed = settings.seed;
  const baseForest = treeInfluence
    ? clamp01(treeInfluence(x, z))
    : fractalNoise2D(x, z, ecology.forestInfluenceScaleM, seed + 21001, 3);
  const forestInfluence = smoothstep(0.32, 0.78, baseForest);
  const edgeWidth = Math.max(0.001, ecology.forestEdgeWidthM);
  const outer = smoothstep(0.32 - 12 / edgeWidth, 0.32 + 12 / edgeWidth, baseForest);
  const inner = smoothstep(0.78 - 12 / edgeWidth, 0.78 + 12 / edgeWidth, baseForest);
  const forestEdge = clamp01(Math.min(outer, 1 - inner) * 1.45);
  const moistureNoise = fractalNoise2D(x + 557.3, z - 811.9, ecology.moistureNoiseScaleM, seed + 22003, 3);
  const heightDamp = 1 - smoothstep(settings.placement.minHeightM, settings.placement.maxHeightM, height) * 0.3;
  const moisture = clamp01(0.5 + (moistureNoise - 0.5) * ecology.moistureStrength + heightDamp * 0.16);
  const shade = clamp01(forestInfluence * ecology.shadeStrength + forestEdge * 0.2);
  const clearingNoise = valueNoise2D(x - 109.2, z + 73.4, ecology.forestInfluenceScaleM * 1.9, seed + 23011);
  const clearing = clamp01((1 - forestInfluence) * 0.75 + forestEdge * ecology.clearingPreference + clearingNoise * 0.2);
  const densityNoise = fractalNoise2D(x, z, ecology.densityNoiseScaleM, seed + 24001, 2);
  const terrainDensity = clamp01(groundWeight * smoothstep(settings.placement.slopeMinY, 1, normalY));
  const density = clamp01(terrainDensity * (1 - ecology.densityNoiseStrength + densityNoise * ecology.densityNoiseStrength));
  const oldForest = valueNoise2D(x + 991.7, z - 219.5, ecology.forestInfluenceScaleM * 2.4, seed + 25013);
  const deadfall = clamp01(forestInfluence * (0.35 + oldForest * ecology.deadfallOldForestBias) + shade * 0.18);

  return { forestInfluence, forestEdge, shade, moisture, clearing, density, deadfall };
}

export function understoryClassWeight(
  cls: UnderstoryClass,
  sample: UnderstoryEcologySample,
  height: number,
  normalY: number,
  settings: UnderstorySettings,
): number {
  const config = settings.classes[cls];
  if (!config.enabled || config.weight <= 0 || config.density <= 0) return 0;
  const heightT = smoothstep(settings.placement.minHeightM, settings.placement.maxHeightM, height);
  const heightWeight = config.heightPreference === "low"
    ? 1 - heightT * 0.75
    : config.heightPreference === "high"
      ? 0.35 + heightT * 0.9
      : 1;
  const shadeWeight = 1 - Math.abs(sample.shade - config.shadePreference) * 0.9;
  const moistureWeight = 1 - Math.abs(sample.moisture - config.moisturePreference) * 0.85;
  const edgeWeight = 1 + sample.forestEdge * config.forestEdgeBias;
  const clearingWeight = cls === "flower" ? 0.45 + sample.clearing * 1.35 : 1;
  const canopyWeight = cls === "sapling" ? 0.42 + sample.forestInfluence * 0.9 + sample.forestEdge * 0.35 : 1;
  const fernWeight = cls === "fern" ? 0.35 + sample.shade * 0.85 + sample.moisture * 0.75 : 1;
  const deadWeight = cls === "dead_log" || cls === "stump" ? 0.25 + sample.deadfall * 1.5 : 1;
  const slopeWeight = clamp(normalY / Math.max(0.001, settings.placement.slopeMinY), 0.2, 1.15);
  return Math.max(
    0,
    config.weight *
      config.density *
      sample.density *
      heightWeight *
      shadeWeight *
      moistureWeight *
      edgeWeight *
      clearingWeight *
      canopyWeight *
      fernWeight *
      deadWeight *
      slopeWeight,
  );
}
