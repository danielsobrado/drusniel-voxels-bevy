import * as THREE from "three";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import { sampleMacroTerrainHeight, sampleMacroTerrainNormal, sampleMacroTerrainMaterial } from "./macroTerrain.js";
import type { FarShellMetrics } from "./farShellMetrics.js";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (Math.abs(span) < 1e-8) return x < edge1 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

function isFiniteNormal(normal: THREE.Vector3): boolean {
  return Number.isFinite(normal.x)
    && Number.isFinite(normal.y)
    && Number.isFinite(normal.z)
    && normal.lengthSq() > 1e-8;
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

type MacroSample = Readonly<{
  height: number;
  normal: THREE.Vector3;
  material: number;
}>;

export function sampleBlendedHeightNormalMaterial(
  x: number,
  z: number,
  distanceFromCenter: number,
  heightProvider: FarHeightProvider | undefined,
  options: FarSummarySamplerOptions,
): HeightNormalMaterial {
  const macroBlend = smoothstep(
    options.macroBlendStartMeters,
    options.macroBlendEndMeters,
    distanceFromCenter,
  );
  let macro: MacroSample | null = null;
  const getMacro = () => {
    macro ??= {
      height: sampleMacroTerrainHeight(x, z),
      normal: sampleMacroTerrainNormal(x, z),
      material: sampleMacroTerrainMaterial(x, z),
    };
    return macro;
  };

  if (!heightProvider || macroBlend >= 1) {
    const m = getMacro();
    return { height: m.height, normal: m.normal, material: m.material };
  }

  let summaryHeight: number;
  let summaryNormal: THREE.Vector3;
  let summaryMaterial: number;
  let usedFallback = false;

  try {
    summaryHeight = heightProvider.sampleHeight(x, z);
    summaryNormal = heightProvider.sampleNormal(x, z);
    summaryMaterial = heightProvider.sampleMaterial?.(x, z) ?? 0;

    if (!Number.isFinite(summaryHeight) || !isFiniteNormal(summaryNormal)) {
      usedFallback = true;
      const m = getMacro();
      summaryHeight = m.height;
      summaryNormal = m.normal;
      summaryMaterial = m.material;
    }
  } catch {
    usedFallback = true;
    const m = getMacro();
    summaryHeight = m.height;
    summaryNormal = m.normal;
    summaryMaterial = m.material;
  }

  if (usedFallback && options.metrics) {
    options.metrics.farSummaryFallbackSamples++;
  }

  if (macroBlend <= 0) {
    return { height: summaryHeight, normal: summaryNormal, material: summaryMaterial };
  }

  const m = getMacro();
  const height = summaryHeight * (1 - macroBlend) + m.height * macroBlend;
  const normal = new THREE.Vector3().copy(summaryNormal).lerp(m.normal, macroBlend).normalize();
  const material = macroBlend > 0.5 ? m.material : summaryMaterial;

  return { height, normal, material };
}
