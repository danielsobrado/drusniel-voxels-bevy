export interface TerrainHeightSampler {
  surfaceHeight(x: number, z: number): number;
}

export interface WaterFlow {
  x: number;
  z: number;
  speed: number;
  progress: number;
  drop: number;
}

export interface WaterFieldResult {
  waterY: number;
  terrainY: number;
  depth: number;
  bodyMask: number;
  /** HYDROLOGY_BODY_* kind (0 = dry); lets materials pick per-body visual behaviour. */
  bodyKind: number;
  /** Metres to the nearest wet<->dry boundary (hydrology chamfer distance; 0 on the
   *  waterline, grows both inland and into open water). Sources without a shoreline
   *  metric report WATER_SHORE_DISTANCE_UNKNOWN so shore-driven effects stay inert. */
  shoreDistance: number;
  flow: WaterFlow;
}

/** Neutral shoreDistance for fake-body/dry samples: far outside any foam/wetness band. */
export const WATER_SHORE_DISTANCE_UNKNOWN = 1e4;

export interface ShoreSurfBandSettings {
  enabled: boolean;
  startDistance: number;
  fullSurfDistance: number;
  level: number;
  maxShallowDepth: number;
}

export interface ClipmapExclusionBandSettings {
  enabled: boolean;
  distance: number;
}

export const FLOW_EPSILON = 1e-6;
export const RIVER_GEOMETRY_CELL_FADE_START = 6;
export const RIVER_GEOMETRY_CELL_FADE_END = 24;

export const STILL_FLOW: WaterFlow = { x: 0, z: 0, speed: 0, progress: 0, drop: 0 };

export interface LakeRuntime {
  center: [number, number];
  radius: [number, number];
  invRadius: [number, number];
  levelOffset: number;
  waterLevel: number;
}

export interface RiverRuntime {
  points: Array<[number, number]>;
  segLengths: number[];
  levelPrefix: number[];
  levels: number[];
  totalLength: number;
  halfWidth: number;
  levelOffset: number;
  downstreamDrop: number;
}
