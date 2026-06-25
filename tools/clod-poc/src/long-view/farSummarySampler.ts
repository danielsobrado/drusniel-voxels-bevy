import * as THREE from "three";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import { sampleMacroTerrainHeight, sampleMacroTerrainNormal, sampleMacroTerrainMaterial } from "./macroTerrain.js";
import type { FarShellMetrics } from "./farShellMetrics.js";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface FarSummarySamplerOptions {
  macroBlendStartMeters: number;
  macroBlendEndMeters: number;
  metrics?: FarShellMetrics;
}

export interface HeightNormalMaterial {
  height: number;
  normal: THREE.Vector3;
  material: number;
}

export function sampleBlendedHeightNormalMaterial(
  x: number,
  z: number,
  distanceFromCenter: number,
  heightProvider: FarHeightProvider | undefined,
  options: FarSummarySamplerOptions,
): HeightNormalMaterial {
  const macroHeight = sampleMacroTerrainHeight(x, z);
  const macroNormal = sampleMacroTerrainNormal(x, z);
  const macroMaterial = sampleMacroTerrainMaterial(x, z);

  if (!heightProvider) {
    return { height: macroHeight, normal: macroNormal, material: macroMaterial };
  }

  let summaryHeight: number;
  let summaryNormal: THREE.Vector3;
  let summaryMaterial: number;
  let usedFallback = false;

  try {
    summaryHeight = heightProvider.sampleHeight(x, z);
    summaryNormal = heightProvider.sampleNormal(x, z);
    summaryMaterial = heightProvider.sampleMaterial?.(x, z) ?? macroMaterial;

    if (!Number.isFinite(summaryHeight)) {
      usedFallback = true;
      summaryHeight = macroHeight;
      summaryNormal = macroNormal;
      summaryMaterial = macroMaterial;
    }
  } catch {
    usedFallback = true;
    summaryHeight = macroHeight;
    summaryNormal = macroNormal;
    summaryMaterial = macroMaterial;
  }

  if (usedFallback && options.metrics) {
    options.metrics.farSummaryFallbackSamples++;
  }

  const macroBlend = smoothstep(
    options.macroBlendStartMeters,
    options.macroBlendEndMeters,
    distanceFromCenter,
  );

  if (macroBlend <= 0) {
    return { height: summaryHeight, normal: summaryNormal, material: summaryMaterial };
  }
  if (macroBlend >= 1) {
    return { height: macroHeight, normal: macroNormal, material: macroMaterial };
  }

  const height = summaryHeight * (1 - macroBlend) + macroHeight * macroBlend;
  const normal = new THREE.Vector3().copy(summaryNormal).lerp(macroNormal, macroBlend).normalize();
  const material = macroBlend > 0.5 ? macroMaterial : summaryMaterial;

  return { height, normal, material };
}
