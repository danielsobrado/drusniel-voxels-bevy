import type { EROSION_SCHEMA_VERSION } from "./constants.js";

export interface TerrainErosionConfig {
  readonly erosion: {
    readonly schemaVersion: typeof EROSION_SCHEMA_VERSION;
    readonly enabled: boolean;
    readonly cellSizeM: number;
    readonly borderCells: number;
    readonly hydraulicIterations: number;
    readonly thermalIterations: number;
    readonly checkpointEveryIterations: number;
    readonly rain: {
      readonly amountPerIterationM: number;
      readonly spatialVariation: number;
    };
    readonly water: {
      readonly gravityMS2: number;
      readonly timeStepS: number;
      readonly evaporationFraction: number;
      readonly maxVelocityCellsPerStep: number;
    };
    readonly sediment: {
      readonly capacityFactor: number;
      readonly erosionRate: number;
      readonly depositionRate: number;
      readonly minimumSlope: number;
      readonly maximumErosionPerIterationM: number;
      readonly maximumDepositionPerIterationM: number;
    };
    readonly thermal: {
      readonly rate: number;
      readonly softTalusDegrees: number;
      readonly hardTalusDegrees: number;
    };
    readonly persistence: {
      readonly compression: "zstd";
      readonly quantizedHeightStepM: number;
      readonly keepWaterField: boolean;
      readonly keepSedimentField: boolean;
      readonly keepDepositionField: boolean;
    };
  };
}

export interface ResolvedErosionConstants {
  readonly rainWaterUnits: number;
  readonly rainVariationQ16: number;
  readonly fluxResponseQ16: number;
  readonly evaporationRetainQ16: number;
  readonly maxVelocityFixed: number;
  readonly capacityFactorQ16: number;
  readonly erosionRateQ16: number;
  readonly depositionRateQ16: number;
  readonly minimumSlopeQ16: number;
  readonly maxErosionSedimentUnits: number;
  readonly maxDepositionSedimentUnits: number;
  readonly thermalRateQ16: number;
  readonly talusHeightUnitsByHardnessByte: Uint32Array;
}

export interface ErosionSourceField {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heightFixed: Int32Array;
  readonly hardness: Uint16Array;
}

export interface ErodedMacroField extends ErosionSourceField {
  readonly sediment: Uint32Array;
  readonly deposition: Int32Array;
  sampleHeightMeters(x: number, z: number): number;
}

export interface SerializedErodedMacroField {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heightFixed: Int32Array;
  readonly hardness: Uint16Array;
  readonly sediment: Uint32Array;
  readonly deposition: Int32Array;
}

export interface ErosionGpuInitialMetadata {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
  readonly borderCells: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
}

export interface ErosionGpuInitialState extends ErosionGpuInitialMetadata {
  readonly stateAData: ArrayBuffer;
  readonly samplingMs: number;
}

export interface ErosionGpuRawOutput {
  readonly initial: ErosionGpuInitialMetadata;
  readonly chunks: readonly ArrayBuffer[];
  readonly byteLength: number;
  readonly samplingMs: number;
  readonly buildMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly checkpointCount: number;
  readonly gpuPassTimingsMs: Readonly<Record<string, number>>;
  readonly timestampQueriesSupported: boolean;
}

export interface ErosionArtifactRef {
  readonly schemaVersion: typeof EROSION_SCHEMA_VERSION;
  readonly id: string;
  readonly hash: string;
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
}

export interface ErosionArtifact {
  readonly ref: ErosionArtifactRef;
  readonly field: ErodedMacroField;
  readonly artifactBytes: number;
  readonly buildMs: number;
  readonly samplingMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly finalizeMs: number;
  readonly persistenceMs: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
  readonly gpuPassTimingsMs: Readonly<Record<string, number>>;
  readonly timestampQueriesSupported: boolean;
}

export interface PersistedErosionArtifact extends ErosionArtifact {
  readonly compressedBytes: ArrayBuffer;
}

export interface ErosionArtifactSummary {
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly erodedM3: number;
  readonly depositedM3: number;
}

export interface ErosionState {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
  readonly borderCells: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heightFixed: Int32Array;
  readonly hardness: Uint16Array;
  water: Uint32Array;
  sediment: Uint32Array;
  sedimentScratch: Uint32Array;
  readonly deposition: Int32Array;
  readonly fluxLeft: Uint32Array;
  readonly fluxRight: Uint32Array;
  readonly fluxUp: Uint32Array;
  readonly fluxDown: Uint32Array;
  readonly velocityX: Int32Array;
  readonly velocityZ: Int32Array;
  readonly capacity: Uint32Array;
  readonly thermalDelta: Int32Array;
  hydraulicIteration: number;
  thermalIteration: number;
}

export interface ErosionCpuCheckpoint {
  readonly kind?: "cpu";
  readonly schemaVersion: typeof EROSION_SCHEMA_VERSION;
  readonly configHash: string;
  readonly sourceTerrainHash: string;
  readonly hydraulicIteration: number;
  readonly thermalIteration: number;
  readonly state: ErosionState;
}

export interface ErosionGpuCheckpoint {
  readonly kind: "gpu";
  readonly schemaVersion: typeof EROSION_SCHEMA_VERSION;
  readonly configHash: string;
  readonly sourceTerrainHash: string;
  readonly hydraulicIteration: number;
  readonly thermalIteration: number;
  readonly initial: ErosionGpuInitialMetadata;
  readonly packedByteLength: number;
  readonly packedChunks: readonly ArrayBuffer[];
}

export type ErosionCheckpoint = ErosionCpuCheckpoint | ErosionGpuCheckpoint;

export interface ErosionBuildInput {
  readonly worldId: string;
  readonly seed: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM?: { readonly x: number; readonly z: number };
  readonly sourceTerrainHash: string;
  readonly configHash: string;
  readonly config: TerrainErosionConfig;
  readonly sampleHeightMeters: (x: number, z: number) => number;
  readonly checkpoint?: ErosionCpuCheckpoint;
  readonly signal?: AbortSignal;
}

export interface ErosionBuildProgress {
  readonly phase: "sampling" | "hydraulic" | "thermal" | "encoding" | "complete";
  readonly hydraulicIteration: number;
  readonly thermalIteration: number;
  readonly percent: number;
  readonly checkpointCount: number;
}

export interface ErosionDiagnostics {
  erosion_enabled: number;
  erosion_schema_version: number;
  erosion_artifact_cache_hit: number;
  erosion_artifact_bytes: number;
  erosion_build_ms: number;
  erosion_sampling_ms: number;
  erosion_gpu_ms: number;
  erosion_readback_ms: number;
  erosion_finalize_ms: number;
  erosion_persistence_ms: number;
  erosion_checkpoint_count: number;
  erosion_progress_percent: number;
  erosion_height_min_m: number;
  erosion_height_max_m: number;
  erosion_total_eroded_m3: number;
  erosion_total_deposited_m3: number;
  erosion_mass_error_ratio: number;
  erosion_cpu_gpu_mismatch_count: number;
  erosion_gpu_timestamp_supported: number;
  erosion_gpu_checkpoint_bytes: number;
  erosion_gpu_checkpoint_resume: number;
  erosion_gpu_checkpoint_persistence_failures: number;
  erosion_main_thread_max_slice_ms: number;
  erosion_artifact_hash_prefix: string;
}

export interface ErosionMaterialChannels {
  readonly sedimentDepthM: number;
  readonly netDepositionM: number;
  readonly hardness01: number;
  readonly wetnessSeed: number;
}
