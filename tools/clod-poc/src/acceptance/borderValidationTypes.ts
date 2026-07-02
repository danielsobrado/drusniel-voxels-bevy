import type { ClodPageNode } from "../types.js";
import type { AcceptanceFailure } from "./acceptanceTypes.js";

export interface BorderValidationInput {
  nodesByLevel: Map<number, ClodPageNode[]>;
  fixtureName: string;
}

export interface BorderValidationOutput {
  passes: boolean;
  maxPositionDelta: number;
  minNormalDot: number;
  maxMaterialWeightDelta: number;
  failures: AcceptanceFailure[];
  failureCount: number;
}

export interface FineEdgeChain {
  positions: [number, number, number][];
  normals: [number, number, number][];
  materials: number[];
  materialWeights: number[][];
}

export interface FootprintInterval {
  start: number;
  end: number;
}

export interface AllMixedLodResult {
  passes: boolean;
  failures: AcceptanceFailure[];
  surfaceFindings: AcceptanceFailure[];
  deltasTested: number;
  edgesTested: number;
  failureCount: number;
  untestableDeltaCount: number;
  maxPosDelta: number;
  minNormDot: number;
  maxMatDelta: number;
}
