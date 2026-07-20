import type { PROBE_GI_CASCADE_IDS } from "./constants.js";

export type ProbeGiCascadeId = (typeof PROBE_GI_CASCADE_IDS)[number];
export type ProbeGiDimensions = readonly [number, number, number];
export type ProbeGiVec3 = readonly [number, number, number];
export type ProbeGiVec4 = readonly [number, number, number, number];
export type ProbeGiUvec4 = readonly [number, number, number, number];
export type ProbeGiDebugMode =
  | "positions"
  | "validity"
  | "age"
  | "cascade"
  | "relocation"
  | "irradiance"
  | "sh_lobe"
  | "first_hit"
  | "unknown"
  | "canopy_extinction";

export interface ProbeGiQualityPreset {
  readonly raysPerProbe: number;
  readonly probesPerFrame: number;
  readonly boostedProbesPerFrame: number;
}

export interface ProbeGiCascadeConfig {
  readonly id: ProbeGiCascadeId;
  readonly dimensions: ProbeGiDimensions;
  readonly spacingM: number;
  readonly layerHeightsM: readonly number[];
  readonly maximumTraceDistanceM: number;
  readonly purposeBias: number;
}

export interface ProbeGiConfig {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly qualityPresets: Readonly<Record<"ultra" | "balanced" | "perf" | "potato", ProbeGiQualityPreset>>;
  readonly lightingChangeBoostFrames: number;
  readonly historyBlend: number;
  readonly boostedHistoryBlend: number;
  readonly raySpread: number;
  readonly hemisphereFloorStrength: number;
  readonly screenSpaceBounceMaxFraction: number;
  readonly cascades: readonly ProbeGiCascadeConfig[];
  readonly canopy: {
    readonly sigmaRgb: ProbeGiVec3;
    readonly transmittedRgb: ProbeGiVec3;
    readonly transmittedEnergyCap: number;
  };
  readonly relocation: {
    readonly enabled: boolean;
    readonly maximumSpacingFraction: number;
    readonly invalidAfterFailedAxes: number;
  };
  readonly positioning: {
    readonly maxMsPerFrame: number;
    readonly maxColumnsPerFrame: number;
    readonly unknownRetryFrames: number;
  };
  readonly dynamicProxies: {
    readonly updateHz: number;
    readonly nearCascadeOnly: boolean;
  };
  readonly debug: {
    readonly enabled: boolean;
    readonly mode: ProbeGiDebugMode;
    readonly freezeUpdates: boolean;
  };
}

export interface ProbeGiRecord {
  readonly shR: ProbeGiVec4;
  readonly shG: ProbeGiVec4;
  readonly shB: ProbeGiVec4;
  readonly positionValidity: ProbeGiVec4;
  readonly normalOffset: ProbeGiVec4;
  readonly revisionFlags: ProbeGiUvec4;
}

export interface ProbeGiOrigin {
  readonly cellX: number;
  readonly cellZ: number;
  readonly worldX: number;
  readonly worldZ: number;
  readonly slotX: number;
  readonly slotZ: number;
}

export interface ProbeGiTerrainProvider {
  heightAt(x: number, z: number, hintM: number): number | null;
  revision(): number;
}

export interface ProbeGiSolidProvider {
  densityAt(x: number, y: number, z: number, hintM: number): number | null;
}

export interface ProbeGiProviders {
  readonly terrain: ProbeGiTerrainProvider;
  readonly solid: ProbeGiSolidProvider;
}

export interface ProbeGiRelocationResult {
  readonly position: ProbeGiVec3;
  readonly offset: ProbeGiVec3;
  readonly valid: boolean;
  readonly relocated: boolean;
  readonly unknown: boolean;
  readonly confidence: number;
  readonly failedAxes: number;
}

export interface ProbeGiCascadeState {
  readonly config: ProbeGiCascadeConfig;
  origin: ProbeGiOrigin;
  readonly records: ArrayBuffer;
  readonly recordFloats: Float32Array;
  readonly recordFlags: Uint32Array;
  readonly columnWorldCellX: Int32Array;
  readonly columnWorldCellZ: Int32Array;
  generation: number;
}
