/* eslint-disable @typescript-eslint/no-explicit-any */
export type TslNode = any;

import type { uniform } from "three/tsl";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";

export interface FarTerrainVertexColors {
  baseColor: Float32Array;
  debugBand: Float32Array;
  macro: Float32Array;
  slope: Float32Array;
  materialWeights: Float32Array;
  normals?: Float32Array;
}

export interface FarTerrainSummaryRingUniformRefs {
  uOriginX: TslNode;
  uOriginZ: TslNode;
  uCellM: TslNode;
  uStartM: TslNode;
  uEndM: TslNode;
  uRowOffsetCells: TslNode;
  uWidthCells: TslNode;
  uHeightCells: TslNode;
  uValid: TslNode;
}

export interface FarTerrainUniformRefs {
  uCenterX: ReturnType<typeof uniform>;
  uCenterZ: ReturnType<typeof uniform>;
  uHazeStart: ReturnType<typeof uniform>;
  uHazeEnd: ReturnType<typeof uniform>;
  uHazeStrength: ReturnType<typeof uniform>;
  uHazeEnabled: ReturnType<typeof uniform>;
  uHazeColor: ReturnType<typeof uniform>;
  uHemiStrength: ReturnType<typeof uniform>;
  uSunStrength: ReturnType<typeof uniform>;
  uAmbientFloor: ReturnType<typeof uniform>;
  uSunDir: ReturnType<typeof uniform>;
  uSunColor: ReturnType<typeof uniform>;
  uSkyColor: ReturnType<typeof uniform>;
  uGroundColor: ReturnType<typeof uniform>;
  uSunVisibilityOriginX: ReturnType<typeof uniform>;
  uSunVisibilityOriginZ: ReturnType<typeof uniform>;
  uSunVisibilityWorldSize: ReturnType<typeof uniform>;
  uSunVisibilityValid: ReturnType<typeof uniform>;
  uSummaryWidthCells?: ReturnType<typeof uniform>;
  uSummaryHeightCells?: ReturnType<typeof uniform>;
  uSummaryValid?: ReturnType<typeof uniform>;
  uSummaryRings?: FarTerrainSummaryRingUniformRefs[];
}

export interface FarTerrainMaterialOptions {
  gpuDisplacement?: boolean;
  heightBiasMeters?: number;
  summaryAtlas?: FarSummaryGpuAtlasView;
}
