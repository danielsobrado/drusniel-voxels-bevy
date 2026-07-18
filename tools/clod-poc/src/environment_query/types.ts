import type {
  ENVIRONMENT_QUERY_FIELD_NAMES,
  ENVIRONMENT_QUERY_SOURCE_NAMES,
} from "./constants.js";

export type EnvironmentQuerySource = (typeof ENVIRONMENT_QUERY_SOURCE_NAMES)[number];
export type EnvironmentQueryField = (typeof ENVIRONMENT_QUERY_FIELD_NAMES)[number];

export interface EnvironmentQueryMeta {
  readonly source: EnvironmentQuerySource;
  readonly revision: number;
  readonly valid: boolean;
  readonly cellSizeM: number;
}

export interface SurfaceQueryResult {
  readonly height: number | null;
  readonly meta: EnvironmentQueryMeta;
}

export interface NormalQueryResult {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly meta: EnvironmentQueryMeta;
}

export interface MaterialWeightsResult {
  readonly grass: number;
  readonly rock: number;
  readonly sand: number;
  readonly snow: number;
  readonly meta: EnvironmentQueryMeta;
}

export interface WaterQueryResult {
  readonly waterY: number;
  readonly carvedBedY: number;
  readonly depth: number;
  readonly wetMask: number;
  readonly shoreDistanceM: number;
  readonly bodyKind: number;
  readonly bodyId: number | null;
  readonly meta: EnvironmentQueryMeta;
}

export interface RiverQueryResult {
  readonly flowX: number;
  readonly flowZ: number;
  readonly flowStrength: number;
  readonly bedDrop: number;
  readonly rapidMask: number;
  readonly channelCenterWeight: number;
  readonly bankContactWeight: number;
  readonly gravelBarMask: number;
  readonly meta: EnvironmentQueryMeta;
}

export interface VisibilityQueryResult {
  readonly sunVisibility: number;
  readonly meta: EnvironmentQueryMeta;
}

export interface EnvironmentQuery {
  surfaceHeightBestEffort(x: number, z: number, hintM?: number): SurfaceQueryResult;
  surfaceNormal(x: number, z: number, hintM?: number): NormalQueryResult;
  materialWeights(x: number, z: number, hintM?: number): MaterialWeightsResult;
  water(x: number, z: number, hintM?: number): WaterQueryResult;
  river(x: number, z: number, hintM?: number): RiverQueryResult;
  visibility(x: number, z: number, hintM?: number): VisibilityQueryResult;
}
