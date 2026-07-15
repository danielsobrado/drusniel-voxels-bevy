import type { ErosionArtifactRef, SerializedErodedMacroField } from "../erosion/types.js";

export const HYDROLOGY_GRAPH_VERSION = "continent-hydrology-v2";
export const DEFAULT_HYDROLOGY_MACRO_SPACING_M = 16;

export interface HydrologyGraphConfig {
  readonly spacingM: number;
  readonly channelThresholdCells: number;
  readonly lakeMinDepthM: number;
  readonly riverBaseWidthM: number;
  readonly riverWidthScaleM: number;
}

export const DEFAULT_HYDROLOGY_GRAPH_CONFIG: HydrologyGraphConfig = Object.freeze({
  spacingM: DEFAULT_HYDROLOGY_MACRO_SPACING_M,
  channelThresholdCells: 96,
  lakeMinDepthM: 0.05,
  riverBaseWidthM: 2,
  riverWidthScaleM: 0.45,
});

export interface HydrologyGraphVertex {
  readonly cell: number;
  readonly x: number;
  readonly z: number;
  readonly bedY: number;
  readonly waterY: number;
  readonly discharge: number;
  readonly widthM: number;
}

export type HydrologyTerminalKind = "river" | "lake" | "ocean" | "terminal";

export interface HydrologyRiverRecord {
  readonly id: string;
  readonly sourceCell: number;
  readonly downstreamCell: number;
  readonly terminalKind: HydrologyTerminalKind;
  readonly downstreamRiverId?: string;
  readonly terminalLakeId?: string;
  readonly vertices: readonly HydrologyGraphVertex[];
}

export interface HydrologyLakeRecord {
  readonly id: string;
  readonly spillCell: number;
  readonly outletCell: number;
  readonly terminal: boolean;
  readonly levelM: number;
  readonly areaCells: number;
  readonly maxDepthM: number;
}

export interface HydrologyErosionAuthority extends SerializedErodedMacroField {
  readonly artifactRef: ErosionArtifactRef;
}

export interface HydrologyMacroGrid {
  readonly resX: number;
  readonly resZ: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM: { readonly x: number; readonly z: number };
  readonly spacingM: number;
  /** Index into `lakes`, or -1 for cells outside a lake. */
  readonly lakeIndex: Int32Array;
  /** Canonical generated base surface. Present for all continent-v2 artifacts. */
  readonly erosion?: HydrologyErosionAuthority;
  /** Cold-build diagnostics. Worker artifacts discard these after graph extraction. */
  readonly buildFields?: {
    readonly originalHeight: Float32Array;
    readonly filledHeight: Float32Array;
    readonly downstream: Int32Array;
    readonly accumulation: Float32Array;
  };
}

export interface HydrologyGraph {
  readonly version: typeof HYDROLOGY_GRAPH_VERSION;
  readonly worldId: string;
  readonly seed: number;
  readonly config: HydrologyGraphConfig;
  readonly macro: HydrologyMacroGrid;
  readonly rivers: readonly HydrologyRiverRecord[];
  readonly lakes: readonly HydrologyLakeRecord[];
}

export interface BuildHydrologyGraphInput {
  readonly worldId: string;
  readonly seed: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM?: { readonly x: number; readonly z: number };
  readonly sampleHeight: (x: number, z: number) => number;
  readonly config?: Partial<HydrologyGraphConfig>;
}

export interface HydrologyMacroSampleCheckpoint {
  readonly resX: number;
  readonly resZ: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM: { readonly x: number; readonly z: number };
  readonly spacingM: number;
  readonly originalHeight: Float32Array;
  nextRow: number;
}
