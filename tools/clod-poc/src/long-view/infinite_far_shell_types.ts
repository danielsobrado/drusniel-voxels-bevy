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
  heightSamplingMode?: FarShellHeightSamplingMode;
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
