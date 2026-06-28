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

function sampleMacro(x: number, z: number): MacroSample {
  return {
    height: sampleMacroTerrainHeight(x, z),
    normal: sampleMacroTerrainNormal(x, z),
    material: sampleMacroTerrainMaterial(x, z),
  };
}

function sampleProvider(
  x: number,
  z: number,
  heightProvider: FarHeightProvider,
): HeightNormalMaterial | null {
  try {
    const height = heightProvider.sampleHeight(x, z);
    const normal = heightProvider.sampleNormal(x, z);
    if (!Number.isFinite(height) || !isFiniteNormal(normal)) return null;
    return {
      height,
      normal,
      material: heightProvider.sampleMaterial?.(x, z) ?? 0,
    };
  } catch {
    return null;
  }
}

export function sampleBlendedHeightNormalMaterial(
  x: number,
  z: number,
  distanceFromCenter: number,
  heightProvider: FarHeightProvider | undefined,
  options: FarSummarySamplerOptions,
): HeightNormalMaterial {
  if (!heightProvider) return sampleMacro(x, z);

  const summary = sampleProvider(x, z, heightProvider);
  if (!summary) {
    options.metrics?.farSummaryFallbackSamples++;
    return sampleMacro(x, z);
  }

  const macroBlend = smoothstep(
    options.macroBlendStartMeters,
    options.macroBlendEndMeters,
    distanceFromCenter,
  );

  if (macroBlend <= 0) return summary;

  const macro = sampleMacro(x, z);
  const height = summary.height * (1 - macroBlend) + macro.height * macroBlend;
  const normal = new THREE.Vector3().copy(summary.normal).lerp(macro.normal, macroBlend).normalize();
  return {
    height,
    normal,
    material: summary.material,
  };
}
