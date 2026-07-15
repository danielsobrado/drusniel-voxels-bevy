import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";
import type {
  ErosionArtifactRef,
  ErosionBuildProgress,
  ErosionGpuInitialState,
  TerrainErosionConfig,
} from "./types.js";

interface ErosionWorkerTerrainInput {
  readonly worldId: string;
  readonly seed: number;
  readonly seaLevelM: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM?: { readonly x: number; readonly z: number };
  readonly terrainFieldConfig: TerrainFieldConfigInput | null;
  readonly config: TerrainErosionConfig;
}

export interface ErosionWorkerBuildRequest extends ErosionWorkerTerrainInput {
  readonly type: "buildErosion";
  readonly requestId: number;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
}

export interface ErosionWorkerSampleRequest extends ErosionWorkerTerrainInput {
  readonly type: "sampleErosionSource";
  readonly requestId: number;
}

export interface ErosionWorkerCancelRequest {
  readonly type: "cancelErosion";
  readonly requestId: number;
}

export type ErosionWorkerRequest = ErosionWorkerBuildRequest | ErosionWorkerSampleRequest | ErosionWorkerCancelRequest;

export interface ErosionWorkerArtifactRecord {
  readonly ref: ErosionArtifactRef;
  readonly compressedBytes: ArrayBuffer;
  readonly buildMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
  readonly cacheHit: boolean;
}

export type ErosionWorkerResponse =
  | { readonly type: "erosionProgress"; readonly requestId: number; readonly progress: ErosionBuildProgress }
  | { readonly type: "erosionSourceSampled"; readonly requestId: number; readonly initial: ErosionGpuInitialState; readonly sampleMs: number }
  | { readonly type: "erosionBuilt"; readonly requestId: number; readonly artifact: ErosionWorkerArtifactRecord }
  | { readonly type: "erosionError"; readonly requestId: number; readonly message: string };
