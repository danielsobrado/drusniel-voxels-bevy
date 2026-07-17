import type { DressingClassId, PersistentDressingClassId } from "./class_registry.js";

export interface DressingStableId {
  readonly lo: number;
  readonly hi: number;
}

export interface VegetationSurfaceSample {
  readonly position: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
  readonly materialWeights: readonly [number, number, number, number];
  readonly waterDepthM: number;
  readonly shoreDistanceM: number;
  readonly flow: readonly [number, number];
  readonly moisture: number;
  readonly wetness: number;
  readonly canopyBroadleaf: number;
  readonly canopyConifer: number;
  readonly skyExposure: number;
  readonly hardness: number;
  readonly sediment: number;
  readonly deposition: number;
  readonly exactVoxelSurface: boolean;
  readonly terrainEdited: boolean;
  readonly structureExcluded: boolean;
  readonly persistentExcluded: boolean;
}

export interface DressingEnvironmentSample extends VegetationSurfaceSample {
  readonly forestEdge: number;
  readonly sunExposure: number;
  readonly caveMouthFactor: number;
  /**
   * Strongest water flow found adjacent to a dry near-shore sample. Dry cells carry
   * zero `flow`, so bank-dwelling classes (river cobbles, driftwood) would otherwise
   * never see the river they sit beside. Unset/[0,0] away from flowing shores.
   */
  readonly bankFlow?: readonly [number, number];
}

export interface DressingTransform {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface SerializedTransform extends DressingTransform {}

export interface DressingCandidate {
  readonly stableId: DressingStableId;
  readonly classId: DressingClassId;
  readonly cellX: number;
  readonly cellZ: number;
  readonly transform: DressingTransform;
  readonly sample: DressingEnvironmentSample;
}

export interface EnvironmentalPropDelta {
  readonly stableId: string;
  readonly classId: PersistentDressingClassId;
  readonly state: "destroyed" | "harvested" | "moved" | "replaced";
  readonly transformOverride?: SerializedTransform;
  readonly payload?: Record<string, unknown>;
}

export interface DressingBounds3D {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}
