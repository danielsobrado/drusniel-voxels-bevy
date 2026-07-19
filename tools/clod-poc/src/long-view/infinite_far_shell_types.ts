import * as THREE from "three";
import type { FarTerrainUniformData } from "../farTerrain/farTerrainUniforms.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import type { FarShellMetrics } from "./farShellMetrics.js";

export type FarShellHeightSamplingMode = "cpu" | "gpu";

export interface InfiniteFarShellOptions {
  innerMeters: number;
  outerMeters: number;
  radialSegments: number;
  angularSegments: number;
  heightBiasMeters: number;
  nearBlendMeters: number;
  farFadeMeters: number;
  macroBlendStartMeters: number;
  macroBlendEndMeters: number;
  rebaseSnapMeters: number;
  lighting: {
    sunDirection: THREE.Vector3;
    sunColor: THREE.Color;
    skyLight: THREE.Color;
    groundLight: THREE.Color;
  };
  useParityMaterial?: boolean;
  parityConfig?: FarTerrainUniformData;
  /** CPU-mode ocean handling: vertices sampled below this height are clamped to it and colored as ocean water. */
  seaLevelMeters?: number;
  heightSamplingMode?: FarShellHeightSamplingMode;
  /** Per-frame CPU budget for sliced height rebuilds after the first reposition (default 2 ms). */
  cpuRebuildBudgetMs?: number;
  farSummaryGpuAtlas?: FarSummaryGpuAtlasView;
  debugShowMissingFallback?: boolean;
  debugShowWireframe?: boolean;
  metrics?: FarShellMetrics;
}

export interface SnappedCenter {
  worldX: number;
  worldZ: number;
  snappedX: number;
  snappedZ: number;
}
