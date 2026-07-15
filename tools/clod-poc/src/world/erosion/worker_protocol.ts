import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";
import type {
  ErosionArtifactRef,
  ErosionBuildProgress,
  ErosionGpuCheckpoint,
  ErosionGpuInitialState,
  ErosionGpuRawOutput,
  SerializedErodedMacroField,
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

export interface ErosionWorkerStoreKey {
  readonly sourceTerrainHash: string;
  readonly configHash: string;
}

export interface ErosionWorkerBuildRequest extends ErosionWorkerTerrainInput, ErosionWorkerStoreKey {
  readonly type: "buildErosion";
  readonly requestId: number;
}

export interface ErosionWorkerSampleRequest extends ErosionWorkerTerrainInput {
  readonly type: "sampleErosionSource";
  readonly requestId: number;
}

export interface ErosionWorkerLoadArtifactRequest extends ErosionWorkerStoreKey {
  readonly type: "loadErosionArtifact";
  readonly requestId: number;
}

export interface ErosionWorkerLoadGpuCheckpointRequest extends ErosionWorkerStoreKey {
  readonly type: "loadErosionGpuCheckpoint";
  readonly requestId: number;
}

export interface ErosionWorkerSaveGpuCheckpointRequest extends ErosionWorkerStoreKey {
  readonly type: "saveErosionGpuCheckpoint";
  readonly requestId: number;
  readonly checkpoint: ErosionGpuCheckpoint;
}

export interface ErosionWorkerClearCheckpointRequest extends ErosionWorkerStoreKey {
  readonly type: "clearErosionCheckpoint";
  readonly requestId: number;
}

export interface ErosionWorkerFinalizeGpuRequest extends ErosionWorkerStoreKey {
  readonly type: "finalizeErosionGpu";
  readonly requestId: number;
  readonly worldId: string;
  readonly raw: ErosionGpuRawOutput;
}

export interface ErosionWorkerCancelRequest {
  readonly type: "cancelErosion";
  readonly requestId: number;
}

export type ErosionWorkerRequest =
  | ErosionWorkerBuildRequest
  | ErosionWorkerSampleRequest
  | ErosionWorkerLoadArtifactRequest
  | ErosionWorkerLoadGpuCheckpointRequest
  | ErosionWorkerSaveGpuCheckpointRequest
  | ErosionWorkerClearCheckpointRequest
  | ErosionWorkerFinalizeGpuRequest
  | ErosionWorkerCancelRequest;

export interface ErosionWorkerArtifactRecord {
  readonly ref: ErosionArtifactRef;
  readonly field: SerializedErodedMacroField;
  readonly canonicalBytes: ArrayBuffer;
  readonly compressedBytes: ArrayBuffer;
  readonly buildMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
  readonly gpuPassTimingsMs: Readonly<Record<string, number>>;
  readonly timestampQueriesSupported: boolean;
  readonly cacheHit: boolean;
}

export type ErosionWorkerResponse =
  | { readonly type: "erosionProgress"; readonly requestId: number; readonly progress: ErosionBuildProgress }
  | { readonly type: "erosionSourceSampled"; readonly requestId: number; readonly initial: ErosionGpuInitialState; readonly sampleMs: number }
  | { readonly type: "erosionArtifactLoaded"; readonly requestId: number; readonly artifact: ErosionWorkerArtifactRecord | null }
  | { readonly type: "erosionGpuCheckpointLoaded"; readonly requestId: number; readonly checkpoint: ErosionGpuCheckpoint | null }
  | { readonly type: "erosionGpuCheckpointSaved"; readonly requestId: number }
  | { readonly type: "erosionCheckpointCleared"; readonly requestId: number }
  | { readonly type: "erosionBuilt"; readonly requestId: number; readonly artifact: ErosionWorkerArtifactRecord }
  | { readonly type: "erosionError"; readonly requestId: number; readonly message: string };
