import type { VegetationCategory, VegetationSurfaceValidity } from "./constants.js";

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

export interface VegetationSurfaceSample {
  readonly positionWs: Vec3;
  readonly normalWs: Vec3;
  readonly materialWeights: Vec4;
  readonly waterDepthM: number;
  readonly shoreDistanceM: number;
  readonly wetness: number;
  readonly moisture: number;
  readonly sediment: number;
  readonly deposition: number;
  readonly hardness: number;
  readonly flow: Vec2;
  readonly canopyCoverage: number;
  readonly canopyHeightM: number;
  readonly caveCoverage: number;
  readonly structureCoverage: number;
  readonly validity: VegetationSurfaceValidity;
  readonly flags: number;
}

export interface VegetationClusterDescriptor {
  readonly clusterX: number;
  readonly clusterZ: number;
  readonly category: VegetationCategory;
  readonly candidateCount: number;
  readonly terrainRevision: number;
  readonly providerRevision: number;
  readonly flags: number;
  readonly reserved: number;
}

export interface ActiveVegetationCluster {
  readonly descriptorIndex: number;
  readonly rejectionMask: number;
  readonly visibilityClass: number;
  readonly reserved: number;
}

export interface VegetationInstancePrefix {
  readonly positionScale: Vec4;
  readonly rotationNormalY: Vec4;
  readonly identity: readonly [number, number, number, number];
}

export interface VegetationGenericInstance extends VegetationInstancePrefix {
  readonly render0: Vec4;
}

export interface VegetationTreeInstance extends VegetationInstancePrefix {
  readonly morphology0: Vec4;
  readonly morphology1: Vec4;
  readonly morphology2: Vec4;
}
